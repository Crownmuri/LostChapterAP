"""
Local WebSocket server the in-game plugin connects to.

Game -> client:
    {"cmd": "Hello", "version": str, "session": str | None}   session is the save folder, None for a normal game
    {"cmd": "Checks", "locations": [int]}   full list of checked location ids, resent freely
    {"cmd": "Goal", "kind": "ending_1" | "ending_2"}
    {"cmd": "DevResult", "text": str}
    {"cmd": "Status", "floor": int}
    {"cmd": "Error", "text": str}

Client -> game:
    {"cmd": "Slot", "connected": bool, "seed": str, "slot": int, "name": str, "slot_data": dict}
    {"cmd": "Items", "items": [{"index": int, "id": int, "name": str, "sender": str, "flags": int}]}   always the full list
    {"cmd": "Scouts", "locations": {location id: {"item": str, "player": str, "flags": int}}}   what the relic places hold
    {"cmd": "Speed", "speed": int}
    {"cmd": "Dev", "args": [str]}
"""
import asyncio
import json
import logging

from typing import Any, Awaitable, Callable, Dict, Optional

import websockets


class GameBridge:
    port: int
    logger: logging.Logger

    on_message: Callable[[Dict[str, Any]], Awaitable[None]]
    on_game_connected: Callable[[], Awaitable[None]]

    server: Optional[Any]
    socket: Optional[Any]

    plugin_version: Optional[str]

    def __init__(
        self,
        port: int,
        logger: logging.Logger,
        on_message: Callable[[Dict[str, Any]], Awaitable[None]],
        on_game_connected: Callable[[], Awaitable[None]],
    ) -> None:
        self.port = port
        self.logger = logger

        self.on_message = on_message
        self.on_game_connected = on_game_connected

        self.server = None
        self.socket = None

        self.plugin_version = None

    @property
    def is_game_connected(self) -> bool:
        return self.socket is not None

    async def start(self) -> None:
        try:
            self.server = await websockets.serve(self._handler, "127.0.0.1", self.port)
        except OSError as e:
            self.logger.error(f"Could not listen on port {self.port} for the game: {e}")

    async def stop(self) -> None:
        if self.server is not None:
            self.server.close()
            await self.server.wait_closed()

    async def send(self, message: Dict[str, Any]) -> None:
        if self.socket is None:
            return

        try:
            await self.socket.send(json.dumps(message))
        except websockets.ConnectionClosed:
            pass

    async def _handler(self, websocket: Any, *_: Any) -> None:
        # Only one game instance at a time, the newest connection wins
        if self.socket is not None:
            await self.socket.close()

        self.socket = websocket
        self.logger.info("Lost Chapter connected to the client.")

        try:
            await self.on_game_connected()

            async for raw in websocket:
                try:
                    message = json.loads(raw)
                except ValueError:
                    continue

                if message.get("cmd") == "Hello":
                    self.plugin_version = message.get("version")

                await self.on_message(message)
        except websockets.ConnectionClosed:
            pass
        finally:
            if self.socket is websocket:
                self.socket = None
                self.plugin_version = None

                self.logger.info("Lost Chapter disconnected from the client.")
