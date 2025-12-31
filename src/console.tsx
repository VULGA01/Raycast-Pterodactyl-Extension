import { Action, ActionPanel, List, showToast, Toast, useNavigation, Icon, getPreferenceValues } from "@raycast/api";
import { useEffect, useState, useRef } from "react";
import WebSocket from "ws";
import { getWebsocketCredentials } from "./api/pterodactyl";
import { Server } from "./api/types";
import stripAnsi from "strip-ansi";

export default function ServerConsole({ server }: { server: Server }) {
    const [logs, setLogs] = useState<string[]>([]);
    const [command, setCommand] = useState("");
    const [isConnected, setIsConnected] = useState(false);
    const socketRef = useRef<WebSocket | null>(null);
    const { pop } = useNavigation();

    useEffect(() => {
        let isMounted = true;

        async function connect() {
            try {
                const { token, socket: socketUrl } = await getWebsocketCredentials(server.attributes.identifier);

                if (!isMounted) return;

                const preferences = getPreferenceValues();
                // Origin header must not have a trailing slash, otherwise Wings rejects it with 403
                const origin = preferences.pterodactylUrl.endsWith("/")
                    ? preferences.pterodactylUrl.slice(0, -1)
                    : preferences.pterodactylUrl;

                const ws = new WebSocket(socketUrl, {
                    headers: {
                        Origin: origin,
                    },
                });
                socketRef.current = ws;

                ws.on("open", () => {
                    if (isMounted) setIsConnected(true);
                    ws.send(JSON.stringify({ event: "auth", args: [token] }));
                    // Request existing logs
                    setTimeout(() => {
                        ws.send(JSON.stringify({ event: "send logs", args: [null] }));
                    }, 500);
                });

                ws.on("message", (data) => {
                    if (!isMounted) return;
                    try {
                        const parsed = JSON.parse(data.toString());
                        if (parsed.event === "console output") {
                            setLogs((prev) => [...prev, ...parsed.args]);
                        } else if (parsed.event === "token expiring") {
                            // Refresh token logic could go here, but for short sessions it's fine.
                            // We could just reconnect.
                            connect();
                        }
                    } catch (e) {
                        // Ignore parse errors
                    }
                });

                ws.on("error", (error) => {
                    console.error("WS Error", error);
                    if (isMounted) {
                        showToast({ style: Toast.Style.Failure, title: "WebSocket Error", message: String(error) });
                        setIsConnected(false);
                    }
                });

                ws.on("close", () => {
                    if (isMounted) setIsConnected(false);
                });

            } catch (error) {
                if (isMounted) {
                    showToast({ style: Toast.Style.Failure, title: "Failed to connect", message: String(error) });
                }
            }
        }

        connect();

        return () => {
            isMounted = false;
            if (socketRef.current) {
                try {
                    // Avoid crashing if socket is closed before connection is established
                    socketRef.current.close();
                } catch (e) {
                    // Ignore cleanup errors
                }
            }
        };
    }, [server.attributes.identifier]);

    const sendCommand = async () => {
        if (!command.trim()) return;
        if (socketRef.current && isConnected) {
            socketRef.current.send(JSON.stringify({ event: "send command", args: [command] }));
            setCommand(""); // Clear input
            showToast({ style: Toast.Style.Success, title: "Command sent" });
        } else {
            showToast({ style: Toast.Style.Failure, title: "Not connected" });
        }
    };



    // ... inside component
    const cleanLog = (log: string) => {
        // Strip ANSI codes and remove common Pterodactyl artifacts like ">...."
        let cleaned = stripAnsi(log);
        // Sometimes Pterodactyl sends "\x1b[K" which strip-ansi handles, but we might have leftovers
        cleaned = cleaned.replace(/^\s*>\.\.\.\.\s*/, ""); // Remove ">...." artifact seen in screenshot
        return cleaned.trim();
    };

    const reversedLogs = [...logs].reverse();

    return (
        <List
            navigationTitle={`Console: ${server.attributes.name}`}
            searchBarPlaceholder="Type a command..."
            searchText={command}
            onSearchTextChange={setCommand}
            throttle={false}
            isShowingDetail={logs.length > 0}
        >
            {logs.length === 0 && (
                <List.EmptyView title={isConnected ? "No logs yet..." : "Connecting..."} icon={isConnected ? Icon.Terminal : Icon.CircleProgress} />
            )}

            {reversedLogs.map((log, index) => {
                const cleaned = cleanLog(log);
                return (
                    <List.Item
                        key={`${index}-${log.substring(0, 10)}`}
                        title={cleaned || " "} // Ensure empty lines don't collapse
                        icon={Icon.Terminal}
                        detail={
                            <List.Item.Detail
                                markdown={`\`\`\`\n${cleaned}\n\`\`\``}
                                metadata={
                                    <List.Item.Detail.Metadata>
                                        <List.Item.Detail.Metadata.Label title="Raw Length" text={String(log.length)} />
                                    </List.Item.Detail.Metadata>
                                }
                            />
                        }
                        actions={
                            <ActionPanel>
                                <Action title="Send Command" icon={Icon.Envelope} onAction={sendCommand} />
                                <Action.CopyToClipboard content={cleaned} title="Copy Log Line" />
                                <Action.CopyToClipboard content={logs.map(cleanLog).join("\n")} title="Copy All Logs" />
                            </ActionPanel>
                        }
                    />
                );
            })}
        </List>
    );
}
