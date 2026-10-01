import { Paperclip, Download, ArrowUpRight, ArrowDownLeft, FileDown, Reply, ReplyAll, Forward } from 'lucide-react';
import { useCompose } from '../../context/ComposeContext';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import NewTaskModal from '../tasks/NewTaskModal';
import { STATUS_PILL, statusLabel, fmtDay } from '../../lib/tasks';
import { fmtDateTime, downloadFile } from '../../lib/utils';
import { personLabel, fmtBytes, senderLabel } from '../../lib/email';
import EmailBody from './EmailBody';
import EmailFiling from './EmailFiling';
import { Highlight } from '../../lib/highlight';

// One email in full: who it's from and to, the filing panel, the body and attachments, and the
// rest of its conversation.
export default function EmailViewer({ message, clients, allTags = [], onTagCreated, onChanged, onOpen, onSent, terms = [] }) {
  const { openCompose, enabled: canCompose } = useCompose();
  const reply = mode => openCompose({ mode, source: message, onSent });
  const [creatingTask, setCreatingTask] = useState(false);
  const [assignees, setAssignees] = useState(null);
  const newTask = async () => { if (!assignees) setAssignees((await api.get('/tasks/assignees')).data); setCreatingTask(true); };
  const files = message.attachments.filter(a => !a.is_inline || !a.content_id);
  return (
    <div className="space-y-4">
      <div>
        {canCompose && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            <button type="button" onClick={() => reply('reply')} className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1 text-sm text-gray-700 hover:bg-gray-50"><Reply className="h-4 w-4" /> Reply</button>
            <button type="button" onClick={() => reply('replyAll')} className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1 text-sm text-gray-700 hover:bg-gray-50"><ReplyAll className="h-4 w-4" /> Reply all</button>
            <button type="button" onClick={() => reply('forward')} className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1 text-sm text-gray-700 hover:bg-gray-50"><Forward className="h-4 w-4" /> Forward</button>
          </div>
        )}
        <h2 className="text-lg font-semibold text-gray-900 break-words">{message.subject ? <Highlight text={message.subject} terms={terms} /> : '(no subject)'}</h2>
        <div className="mt-1 space-y-0.5 text-sm text-gray-600">
          <p className="flex items-center gap-1.5">
            {message.direction === 'out'
              ? <ArrowUpRight className="h-4 w-4 text-indigo-500" title="Sent" />
              : <ArrowDownLeft className="h-4 w-4 text-green-600" title="Received" />}
            <span className="font-medium text-gray-900">{personLabel({ name: message.from_name, address: message.from_address })}</span>
          </p>
          <p><span className="text-gray-400">To:</span> {message.to.map(personLabel).join(', ') || '—'}</p>
          {message.cc.length > 0 && <p><span className="text-gray-400">Cc:</span> {message.cc.map(personLabel).join(', ')}</p>}
          <p className="text-gray-400">
            {fmtDateTime(message.received_at)}
            {message.folder && <> · Outlook folder: {message.folder}</>}
            {message.mailbox_removed_at && <> · deleted from the mailbox (kept here)</>}
          </p>
        </div>
      </div>

      {message.task ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_PILL[message.task.status]}`}>{statusLabel(message.task.status)}</span>
          <span className="min-w-0 flex-1 truncate text-gray-800">Task: {message.task.title}
            {message.task.next_step && <span className="text-gray-500"> · Next: {message.task.next_step}</span>}
            {message.task.status === 'waiting' && message.task.follow_up_at && <span className="text-gray-500"> · follow up {fmtDay(message.task.follow_up_at)}</span>}
            {message.task.assigned_name && <span className="text-gray-500"> · {message.task.assigned_name}</span>}
          </span>
          <Link to={`/tasks?status=${message.task.status}&id=${message.task.id}`} className="text-xs font-medium text-indigo-600 hover:underline">Open task</Link>
        </div>
      ) : (
        <button type="button" onClick={newTask} className="text-xs text-indigo-600 hover:underline">+ Create a task for this email</button>
      )}
      {creatingTask && assignees && (
        <NewTaskModal messageId={message.id} defaultTitle={(message.subject || '').replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, '')} clientIds={message.clients.map(c => c.id)}
          assignees={assignees} onClose={() => setCreatingTask(false)} onCreated={async () => { setCreatingTask(false); onChanged?.((await api.get(`/email/messages/${message.id}`)).data); }} />
      )}

      {clients && <EmailFiling message={message} clients={clients} allTags={allTags} onTagCreated={onTagCreated} onDone={onChanged} />}

      <div className="border-t border-gray-100 pt-3">
        <EmailBody message={message} terms={terms} />
      </div>

      {files.length > 0 && (
        <div className="border-t border-gray-100 pt-3">
          <p className="mb-1.5 flex items-center gap-1 text-sm font-medium text-gray-700"><Paperclip className="h-4 w-4" /> Attachments</p>
          <ul className="flex flex-wrap gap-2">
            {files.map(a => (
              <li key={a.id}>
                <button type="button" onClick={() => downloadFile(api, `/email/attachments/${a.id}`, a.filename || 'attachment')}
                  className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1 text-sm text-gray-700 hover:bg-gray-50">
                  <Download className="h-3.5 w-3.5" /> {a.filename || 'attachment'} <span className="text-xs text-gray-400">{fmtBytes(a.size)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {message.thread.length > 0 && (
        <div className="border-t border-gray-100 pt-3">
          <p className="mb-1.5 text-sm font-medium text-gray-700">Same conversation</p>
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            {message.thread.map(t => (
              <li key={t.id}>
                <button type="button" onClick={() => onOpen?.(t.id)} disabled={!onOpen}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-gray-50 disabled:cursor-default">
                  {t.direction === 'out' ? <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-indigo-500" /> : <ArrowDownLeft className="h-3.5 w-3.5 shrink-0 text-green-600" />}
                  <span className="truncate text-gray-800">{senderLabel(t)}</span>
                  <span className="truncate text-gray-500">{t.subject}</span>
                  <span className="ml-auto shrink-0 text-xs text-gray-400">{fmtDateTime(t.received_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="text-right">
        <button type="button" onClick={() => downloadFile(api, `/email/messages/${message.id}/eml`, `${(message.subject || 'email').slice(0, 80)}.eml`)}
          className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
          <FileDown className="h-3.5 w-3.5" /> Download original (.eml)
        </button>
      </div>
    </div>
  );
}
