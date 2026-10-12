(() => {
  if (window.__kaeruSaveBlob || !window.CanvasDownloads) return;
  let sequence = 0, queue = Promise.resolve();
  const waiting = new Map();
  CanvasDownloads.onmessage = event => {
    const response = JSON.parse(event.data), waiter = waiting.get(response.id);
    if (!waiter) return;
    waiting.delete(response.id);
    if (response.error) waiter.reject(new Error(response.error));
    else waiter.resolve(response);
  };
  function send(id, action, extra = {}) {
    return new Promise((resolve, reject) => {
      waiting.set(id, {resolve, reject});
      CanvasDownloads.postMessage(JSON.stringify({id, action, ...extra}));
    });
  }
  function base64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(new Error('ファイルを読み込めません'));
      reader.readAsDataURL(blob);
    });
  }
  window.__kaeruSaveBlob = (url, name) => {
    // Fetch now: the Web app may revoke this blob URL while the save dialog is open.
    const bytes = fetch(url).then(response => {
      if (!response.ok) throw new Error('ファイルを取得できません');
      return response.blob();
    });
    bytes.catch(() => {});
    const id = String(++sequence);
    const task = queue.then(async () => {
      const blob = await bytes;
      await send(id, 'begin', {name: name || 'KaeruNote', mime: blob.type, size: blob.size});
      for (let offset = 0; offset < blob.size; offset += 262144) {
        const chunk = await base64(blob.slice(offset, offset + 262144));
        await send(id, 'chunk', {offset, data: chunk});
      }
      await send(id, 'finish');
    }).catch(error => {
      CanvasDownloads.postMessage(JSON.stringify({id, action: 'cancel'}));
      window.dispatchEvent(new CustomEvent('canvas-download-failed', {detail: error.message}));
    });
    queue = task;
    return task;
  };
  const isLocal = url => /^(blob:|data:)/i.test(url || '');
  const originalClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (isLocal(this.href) && this.hasAttribute('download')) {
      void window.__kaeruSaveBlob(this.href, this.download);
      return;
    }
    return originalClick.call(this);
  };
  document.addEventListener('click', event => {
    const link = event.target.closest?.('a[download]');
    if (!link || !isLocal(link.href)) return;
    event.preventDefault();
    void window.__kaeruSaveBlob(link.href, link.download);
  }, true);
})();
