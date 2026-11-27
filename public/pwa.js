(() => {
  const connectionStatus = document.getElementById('connectionStatus');
  const installButton = document.getElementById('installApp');
  let installPrompt = null;

  function updateConnectionStatus() {
    if (!connectionStatus) return;
    const online = navigator.onLine;
    connectionStatus.textContent = online
      ? 'Browser reports online. PNR lookups may still be unavailable if the service is unreachable.'
      : 'Browser reports offline. Saved requisition drafts are available; PNR lookups need internet.';
    connectionStatus.classList.toggle('offline', !online);
  }

  window.addEventListener('online', updateConnectionStatus);
  window.addEventListener('offline', updateConnectionStatus);
  updateConnectionStatus();

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    if (installButton) installButton.hidden = false;
  });

  if (installButton) {
    installButton.addEventListener('click', async () => {
      if (!installPrompt) return;
      installButton.disabled = true;
      try {
        await installPrompt.prompt();
        await installPrompt.userChoice;
        installPrompt = null;
        installButton.hidden = true;
      } catch (error) {
        console.error('Could not start app installation:', error);
        if (connectionStatus) connectionStatus.textContent = 'Could not start installation. Use your browser menu to install the app.';
      } finally {
        installButton.disabled = false;
      }
    });
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js').catch(error => {
      console.error('Offline app support could not be registered:', error);
      if (connectionStatus) connectionStatus.textContent += ' Offline support could not be initialized.';
    });
  }
})();
