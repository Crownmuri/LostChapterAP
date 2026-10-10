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

    def _cmd_install(self) -> None:
        """Install the Archipelago plugin into the Lost Chapter folder."""
        self.ctx.install_plugin()

    def _cmd_uninstall(self) -> None:
        """Remove the Archipelago plugin from the Lost Chapter folder."""
        game_path = self.ctx.game_path

        if game_path is None:
            self.output("Lost Chapter install not found.")
            return

        game_install.uninstall_plugin(game_path)
        self.output("Plugin removed.")

    def _cmd_launch(self) -> None:
        """Launch Lost Chapter through Steam."""
        self.ctx.launch_game()

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

        if game_path is not None and not game_install.is_plugin_installed(game_path):
            self.install_plugin()

        game_install.launch_game()

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
        elif cmd == "ReceivedItems":
            Utils.async_start(self.send_items())

        # UT Tab Integration
        super().on_package(cmd, args)

    async def sync_game(self) -> None:
        """Brings a freshly connected game (or a freshly connected slot) up to date."""
        if not self.slot or not self.slot_data:
            await self.bridge.send({"cmd": "Slot", "connected": False})
            return

        await self.bridge.send({
            "cmd": "Slot",
            "connected": True,
            "seed": self.seed_name,
            "slot": self.slot,
            "slot_data": self.slot_data,
        })

        await self.send_items()

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
            })

        await self.bridge.send({"cmd": "Items", "items": items})

    async def on_game_message(self, message: Dict[str, Any]) -> None:
        cmd = message.get("cmd")

        if cmd == "Checks":
            if self.slot:
                await self.check_locations(message.get("locations", []))
        elif cmd == "Goal":
            if not self.slot or self.finished_game:
                return

            # The true ending also satisfies the plain ending goal
            if self.slot_data.get("goal", 0) == 0 or message.get("kind") == "true_ending":
                self.finished_game = True

                await self.send_msgs([{"cmd": "StatusUpdate", "status": CommonClient.ClientStatus.CLIENT_GOAL}])
        elif cmd == "Status":
            self.floor = message.get("floor")
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
