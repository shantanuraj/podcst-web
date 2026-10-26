import { connectDeletionTabs } from '../../src/shared/auth/deletion-tabs';

const pause = () => new Promise((resolve) => setTimeout(resolve, 20));
async function run() {
  if (location.pathname === '/peer') {
    connectDeletionTabs(async (account) => {
      if (account === 'fail') throw new Error('media failure');
      localStorage.setItem('retired', account);
    });
    localStorage.setItem('ready', 'true');
    return;
  }
  const retirement = connectDeletionTabs(async () => {});
  const peer = window.open('/peer');
  if (!peer) throw new Error('Missing peer tab');
  try {
    for (let i = 0; i < 200 && localStorage.getItem('ready') !== 'true'; i++)
      await pause();
    if (localStorage.getItem('ready') !== 'true')
      throw new Error('Peer did not open');
    await retirement.retire('a');
    if (localStorage.getItem('retired') !== 'a')
      throw new Error('Peer did not acknowledge account retirement');
    let refused = false;
    try {
      await retirement.retire('fail');
    } catch {
      refused = true;
    }
    if (!refused) throw new Error('Failed media cleanup was acknowledged');
    await fetch('/result', {
      method: 'POST',
      body: JSON.stringify({
        passed: true,
        checks: { acknowledged: true, failureRetained: true },
      }),
    });
  } finally {
    peer.close();
    retirement.close();
  }
}
run().catch((error) =>
  fetch('/result', {
    method: 'POST',
    body: JSON.stringify({ passed: false, error: String(error) }),
  }),
);
