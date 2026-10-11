import asyncio
import sys
import urllib.parse

import CommonClient
import NetUtils
import Utils

from typing import Any, Dict, List, Optional, Set

from . import data, game_install
from .bridge import GameBridge
from .world import LostChapterWorld

# UT Tab Integration
tracker_loaded: bool = False

try:
    from worlds.tracker.TrackerClient import TrackerGameContext as Context
    from worlds.tracker.TrackerClient import TrackerCommandProcessor as CommandProcessor

    tracker_loaded = True
except ModuleNotFoundError:
    from CommonClient import CommonContext as Context
    from CommonClient import ClientCommandProcessor as CommandProcessor


class LostChapterCommandProcessor(CommandProcessor):
    ctx: "LostChapterContext"

    def _cmd_patch(self) -> None:
        """Install the Archipelago plugin into the Lost Chapter folder."""
        self.ctx.install_plugin()

    def _cmd_unpatch(self) -> None:
        """Remove the Archipelago plugin from the Lost Chapter folder."""
        game_path = self.ctx.game_path

        if game_path is None:
            self.output("Lost Chapter install not found.")
            return

        game_install.uninstall_plugin(game_path)
        self.output("Plugin removed.")

    def _cmd_run(self) -> None:
        """Launch Lost Chapter for the connected slot, patching it first if needed."""
        self.ctx.launch_game()

    def _cmd_speed(self, speed: str = "2") -> None:
        """Set the game speed, 1 to 4. F7 in the game toggles between 1x and 2x."""
        Utils.async_start(self.ctx.bridge.send({"cmd": "Speed", "speed": speed}))

    def _cmd_dev(self, *args: str) -> None:
        """Send a dev command to the game, /dev help lists them. Needs dev_mode in host.yaml."""
        if not self.ctx.world_settings("dev_mode", False):
            self.output("Dev commands are off. Set lost_chapter_options.dev_mode to true in host.yaml.")
            return

        if not self.ctx.bridge.is_game_connected:
            self.output("The game is not connected.")
            return

        Utils.async_start(self.ctx.bridge.send({"cmd": "Dev", "args": list(args)}))

    def _cmd_game(self) -> None:
        """Show the state of the game connection."""
        ctx = self.ctx
        game_path = ctx.game_path

        self.output(f"Install: {game_path or 'not found'}")

        if game_path:
            self.output(f"Plugin installed: {game_install.is_plugin_installed(game_path)}")

        self.output(f"Game connected: {ctx.bridge.is_game_connected} (port {ctx.bridge.port})")


class LostChapterContext(Context):
    tags: Set[str] = {"AP"}
    game: str = data.GAME_NAME
    command_processor = LostChapterCommandProcessor
    items_handling: int = 0b111
    want_slot_data: bool = True

    bridge: GameBridge
    slot_data: Dict[str, Any]
    floor: Optional[int]
    status: Dict[str, Any]  # what the game last reported about the run: floor, faith, virtue, lewd, stats, ...

    tracker_loaded: bool

    locations_in_logic: List[str]

    def __init__(self, server_address: Optional[str], password: Optional[str]) -> None:
        super().__init__(server_address, password)

        self.bridge = GameBridge(
            port=int(self.world_settings("bridge_port", 38472)),
            logger=CommonClient.logger,
            on_message=self.on_game_message,
            on_game_connected=self.sync_game,
        )

        self.slot_data = dict()
        self.floor = None
        self.status = dict()

        self.tracker_loaded = tracker_loaded

        self.locations_in_logic = list()

        if self.tracker_loaded:
            def update_locations_in_logic(locations_in_logic: List[str]):
                self.locations_in_logic = locations_in_logic

            self.update_callback = update_locations_in_logic

    @staticmethod
    def world_settings(key: str, default: Any) -> Any:
        try:
            return getattr(LostChapterWorld.settings, key)
        except Exception:
            return default

    @property
    def game_path(self) -> Optional[str]:
        return game_install.find_game_path(str(self.world_settings("game_path", "")))

    def install_plugin(self) -> None:
        game_path = self.game_path

        if game_path is None:
            CommonClient.logger.error(
                "Lost Chapter install not found. Set lost_chapter_options.game_path in host.yaml."
            )
            return

        try:
            game_install.install_plugin(game_path, self.bridge.port)
        except (OSError, RuntimeError) as e:
            CommonClient.logger.error(f"Could not install the plugin: {e}")
            return

        CommonClient.logger.info(f"Plugin installed into {game_path}. Restart the game if it is running.")

    def launch_game(self) -> None:
        game_path = self.game_path

        if game_path is None:
            CommonClient.logger.error(
                "Lost Chapter install not found. Set lost_chapter_options.game_path in host.yaml."
            )
            return

        if not self.slot or not self.seed_name:
            CommonClient.logger.error("Connect to the multiworld first, /run launches the game for the connected slot.")
            return

        # Also replaces the plugin of an older apworld
        if not game_install.is_plugin_current(game_path):
            self.install_plugin()

        folder = game_install.write_session(game_path, self.seed_name, self.slot)
        CommonClient.logger.info(f"Launching Lost Chapter with its own save for this slot ({folder}).")

        game_install.launch_game()

    async def shutdown(self):
        # Without the session file the game starts as the normal game with its normal save
        game_path = self.game_path

        if game_path is not None:
            try:
                game_install.clear_session(game_path)
            except OSError:
                pass

        await super().shutdown()

    def make_gui(self):
        from .gui import bootstrap_client_gui
        return bootstrap_client_gui(super().make_gui())

    async def server_auth(self, password_requested: bool = False):
        if password_requested and not self.password:
            await super().server_auth(password_requested)

        await self.get_username()
        await self.send_connect()

    async def disconnect(self, allow_autoreconnect: bool = False):
        self.slot_data = dict()

        await self.bridge.send({"cmd": "Slot", "connected": False})
        await super().disconnect(allow_autoreconnect)

    def on_package(self, cmd: str, args: Any) -> None:
        if cmd == "Connected":
            self.slot_data = args["slot_data"]

            Utils.async_start(
                self.send_msgs([{"cmd": "StatusUpdate", "status": CommonClient.ClientStatus.CLIENT_PLAYING}])
            )
            Utils.async_start(self.sync_game())
            Utils.async_start(self.update_death_link(bool(self.slot_data.get("death_link"))))

            # The game shows what the place of a relic or a card holds instead of the relic or the card
            relic_locations = {data.RELIC_OFFSET + weapon_id for weapon_id in data.RELICS}
            relic_locations |= {data.CARD_OFFSET + item_id for item_id in data.CARDS}
            relic_locations &= self.server_locations

            if relic_locations:
                Utils.async_start(self.send_msgs([{"cmd": "LocationScouts", "locations": sorted(relic_locations)}]))
        elif cmd == "LocationInfo":
            Utils.async_start(self.send_scouts())
        elif cmd == "ReceivedItems":
            Utils.async_start(self.send_items())

        # UT Tab Integration
        super().on_package(cmd, args)

    def on_deathlink(self, data: Dict[str, Any]) -> None:
        super().on_deathlink(data)

        # The run of the game ends: in the fight that is on, or before the next floor
        Utils.async_start(self.bridge.send({"cmd": "Death", "source": data.get("source", "")}))

    def on_print_json(self, args: dict) -> None:
        super().on_print_json(args)

        # An item of this slot's world that went to somebody else is announced in the game too. What comes back to
        # this slot is announced there when it arrives.
        item = args.get("item")
        receiving = args.get("receiving")

        if args.get("type") == "ItemSend" and item is not None and item.player == self.slot and receiving != self.slot:
            name = self.item_names.lookup_in_slot(item.item, receiving)
            text = f"Sent {name} to {self.player_names.get(receiving, 'another player')}"

            Utils.async_start(self.bridge.send({"cmd": "Notice", "text": text, "flags": item.flags}))

    async def sync_game(self) -> None:
        """Brings a freshly connected game (or a freshly connected slot) up to date."""
        if not self.slot or not self.slot_data:
            await self.bridge.send({"cmd": "Slot", "connected": False})
            return

        locations = self.missing_locations | self.checked_locations

        await self.bridge.send({
            "cmd": "Slot",
            "connected": True,
            "seed": self.seed_name,
            "slot": self.slot,
            "name": self.player_names.get(self.slot, ""),
            "slot_data": self.slot_data,
            # The checks of each floor event that this seed has, for the count in the floor choice
            "event_checks": {
                str(event_id): [location for location in data.event_locations(event_id) if location in locations]
                for event_id in data.EVENTS
            },
        })

        await self.send_items()
        await self.send_scouts()

    async def send_scouts(self) -> None:
        if not self.slot or not self.locations_info:
            return

        scouts: Dict[str, Dict[str, Any]] = dict()

        location: int
        network_item: NetUtils.NetworkItem
        for location, network_item in self.locations_info.items():
            scouts[str(location)] = {
                "item": self.item_names.lookup_in_slot(network_item.item, network_item.player),
                "player": self.player_names.get(network_item.player, ""),
                "flags": network_item.flags,
            }

        await self.bridge.send({"cmd": "Scouts", "locations": scouts})

    async def send_items(self) -> None:
        if not self.slot:
            return

        items: List[Dict[str, Any]] = list()

        index: int
        network_item: NetUtils.NetworkItem
        for index, network_item in enumerate(self.items_received):
            items.append({
                "index": index,
                "id": network_item.item,
                "name": self.item_names.lookup_in_game(network_item.item),
                "sender": self.player_names.get(network_item.player, "Server"),
                "flags": network_item.flags,
            })

        await self.bridge.send({"cmd": "Items", "items": items})

    async def on_game_message(self, message: Dict[str, Any]) -> None:
        cmd = message.get("cmd")

        if cmd == "Hello":
            if not message.get("session"):
                CommonClient.logger.warning(
                    "Lost Chapter is running as the normal game with its normal save. "
                    "Close it and type /run to play this multiworld."
                )
        elif cmd == "Checks":
            if self.slot:
                await self.check_locations(message.get("locations", []))
        elif cmd == "Goal":
            if not self.slot or self.finished_game:
                return

            # The game lists every goal its wins have reached, by the value of the goal option
            if self.slot_data.get("goal", 0) in message.get("goals", []):
                self.finished_game = True

                await self.send_msgs([{"cmd": "StatusUpdate", "status": CommonClient.ClientStatus.CLIENT_GOAL}])
        elif cmd == "Death":
            # Every game over of the game, passed on with DeathLink
            if self.slot and "DeathLink" in self.tags:
                name = self.player_names[self.slot]

                await self.send_death(f"{name} met their end on floor {message.get('floor', '?')} of Lost Chapter.")
        elif cmd == "Status":
            self.status.update(message)
            self.floor = self.status.get("floor")
        elif cmd == "DevResult":
            for line in str(message.get("text", "")).split("\n"):
                CommonClient.logger.info(f"[Dev] {line}")
        elif cmd == "Error":
            CommonClient.logger.error(f"[Game] {message.get('text')}")


def main(*args) -> None:
    Utils.init_logging("LostChapterClient", exception_logger="Client")

    parser = CommonClient.get_base_parser(description="Lost Chapter Client")

    parser.add_argument("url", nargs="?", help="Archipelago Connection URL")
    parser.add_argument("--name", default=None, help="Archipelago Slot Name")

    args = parser.parse_args(args)

    if args.url:
        url = urllib.parse.urlparse(args.url)
        args.connect = url.netloc
        if url.username:
            args.name = urllib.parse.unquote(url.username)
        if url.password:
            args.password = urllib.parse.unquote(url.password)

    async def _main(_args):
        ctx: LostChapterContext = LostChapterContext(_args.connect, _args.password)
        ctx.auth = _args.name

        ctx.server_task = asyncio.create_task(CommonClient.server_loop(ctx), name="server loop")

        await ctx.bridge.start()

        # UT Tab Integration
        if tracker_loaded:
            ctx.run_generator()

        if CommonClient.gui_enabled:
            ctx.run_gui()

        ctx.run_cli()

        await ctx.exit_event.wait()
        await ctx.bridge.stop()
        await ctx.shutdown()

    import colorama

    colorama.just_fix_windows_console()

    asyncio.run(_main(args))

    colorama.deinit()


if __name__ == "__main__":
    main(*sys.argv[1:])
