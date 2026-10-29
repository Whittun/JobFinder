import RemoteView from './RemoteView'
import PriorityView from './PriorityView'
import './App.css'

export default function App() {
  const view = new URLSearchParams(window.location.search).get('view')
  if (view === 'influence') return <PriorityView influenceOnly />
  return view === 'priority' ? <PriorityView /> : <RemoteView />
}
