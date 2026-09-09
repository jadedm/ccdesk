import { useState, type KeyboardEvent } from 'react';
import type { PermissionRequest } from '../../../shared/protocol.ts';
import type { SessionStatus } from '../state.ts';

type Props = {
  status: SessionStatus;
  permission: PermissionRequest | null;
  onSend: (text: string) => void;
  onInterrupt: () => void;
  onPermission: (requestId: string, behavior: 'allow' | 'deny', always: boolean) => void;
};

const PermissionCard = ({ request, onPermission }: { request: PermissionRequest; onPermission: Props['onPermission'] }) => (
  <div className="permission">
    <div className="card">
      <div className="t">{request.title ?? `${request.toolName} wants to run`}</div>
      {request.description && <div className="d">{request.description}</div>}
      <pre>{JSON.stringify(request.input, null, 2)}</pre>
      <div className="actions">
        <button className="btn primary" onClick={() => onPermission(request.requestId, 'allow', false)}>Allow</button>
        {request.suggestions && request.suggestions.length > 0 && (
          <button className="btn" onClick={() => onPermission(request.requestId, 'allow', true)}>Allow always</button>
        )}
        <button className="btn danger" onClick={() => onPermission(request.requestId, 'deny', false)}>Deny</button>
      </div>
    </div>
  </div>
);

export const Composer = ({ status, permission, onSend, onInterrupt, onPermission }: Props) => {
  const [text, setText] = useState('');
  const submit = () => {
    const trimmed = text.trim();
    if (trimmed === '') return;
    onSend(trimmed);
    setText('');
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    submit();
  };
  const running = status === 'running';
  const hint = status === 'history' ? 'Enter resumes this session with your message' : 'Enter to send, Shift Enter for a new line';
  return (
    <div className="bottom">
      {permission && <PermissionCard request={permission} onPermission={onPermission} />}
      <div className="composer">
        <textarea
          value={text}
          rows={Math.min(8, Math.max(1, text.split('\n').length))}
          placeholder="Message Claude"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          aria-label="message"
        />
        {running ? (
          <button className="btn danger" onClick={onInterrupt}>Interrupt</button>
        ) : (
          <button className="btn primary" onClick={submit} disabled={text.trim() === ''}>Send</button>
        )}
      </div>
      <div className="composer" style={{ paddingTop: 0 }}>
        <span className="hint">{hint}</span>
      </div>
    </div>
  );
};
