import "./App.css";
import RemoteView from "./RemoteView";
import WorkspaceView from "./WorkspaceView";

export default function App() {
  const view = new URLSearchParams(window.location.search).get("view");
  if (view === "processed" || view === "letters")
    return <WorkspaceView key={view} tab={view} />;
  return <RemoteView />;
}
