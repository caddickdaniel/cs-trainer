import { Link } from 'react-router-dom';
import { Panel } from '../components/ui';

export function NotFoundPage() {
  return (
    <Panel title="Page not found">
      <p>That page does not exist.</p>
      <Link className="btn" to="/">Back to Home</Link>
    </Panel>
  );
}
