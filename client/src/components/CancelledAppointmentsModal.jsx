import { useEffect, useState } from 'react';
import api from '../lib/api';
import Modal from './ui/Modal';
import { NotifyBtn } from './AppointmentModal';
import { fmtDate, fmtTime } from '../lib/utils';

export default function CancelledAppointmentsModal({ onClose }) {
  const [appointments, setAppointments] = useState(null);
  const [notifyStatus, setNotifyStatus] = useState({});

  useEffect(() => {
    const from = new Date(); from.setDate(from.getDate() - 90);
    const to = new Date(); to.setDate(to.getDate() + 90);
    api.get(`/appointments?status=cancelled&from=${from.toISOString().slice(0,10)}&to=${to.toISOString().slice(0,10)}`)
      .then(r => setAppointments(r.data.sort((a, b) => new Date(b.start_time) - new Date(a.start_time))));
  }, []);

  const notify = async (apptId, target) => {
    const key = `${apptId}-${target}`;
    setNotifyStatus(s => ({ ...s, [key]: 'sending' }));
    try {
      await api.post(`/appointments/${apptId}/notify`, { eventType: 'cancelled', target, scope: 'this_only' });
      setNotifyStatus(s => ({ ...s, [key]: 'sent' }));
    } catch (e) {
      const msg = e.response?.data?.errors?.[0] || e.response?.data?.error || 'Failed';
      setNotifyStatus(s => ({ ...s, [key]: { error: msg } }));
    }
  };

  return (
    <Modal title="Cancelled Appointments" onClose={onClose} wide>
      <div className="space-y-2">
        {appointments === null && <p className="text-sm text-gray-400 py-6 text-center">Loading…</p>}
        {appointments?.length === 0 && <p className="text-sm text-gray-400 py-6 text-center">No cancelled appointments in the last 90 days.</p>}
        {appointments?.map(a => (
          <div key={a.id} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800">{a.client_name} · {a.practitioner_name}</p>
              <p className="text-xs text-gray-400">{fmtDate(a.start_time)} {fmtTime(a.start_time)}</p>
            </div>
            <NotifyBtn label="Notify Practitioner" target="practitioner" status={notifyStatus[`${a.id}-practitioner`]} onClick={() => notify(a.id, 'practitioner')} />
            <NotifyBtn label="Notify Client" target="client" status={notifyStatus[`${a.id}-client`]} onClick={() => notify(a.id, 'client')} />
          </div>
        ))}
      </div>
    </Modal>
  );
}
