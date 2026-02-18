'use client';
import { useEffect, useState } from 'react';
import { SetupWizard } from './wizard/SetupWizard';

export function WizardMount() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const done = localStorage.getItem('setup_complete');
    if (done) return;

    fetch('/api/setup/status')
      .then((r) => r.json())
      .then((data: { configured: boolean }) => {
        if (!data.configured) setShow(true);
      })
      .catch(() => {
        /* ignore */
      });
  }, []);

  if (!show) return null;
  return (
    <SetupWizard
      onClose={() => {
        setShow(false);
        localStorage.setItem('setup_complete', 'true');
      }}
    />
  );
}
