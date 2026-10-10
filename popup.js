'use strict';
const btn = document.getElementById('extract');
const status = document.getElementById('status');
function setStatus(message, isError = false) {
  status.textContent = message;
  status.className = isError ? 'error' : 'success';
}
btn.addEventListener('click', async () => {
  btn.disabled = true;
  setStatus('Reading the displayed post…');
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tab?.id || !/^https:\/\/(?:www\.|m\.|web\.)?facebook\.com\//i.test(tab.url || '')) {
      throw new Error('Open a Facebook post at facebook.com first.');
    }
    let result;
    try {
      const injected = await chrome.scripting.executeScript({
        target: {tabId: tab.id, allFrames: false},
        files: ['extract.js']
      });
      result = injected?.[0]?.result;
    } catch (error) {
      result = {ok:false,error:error?.message || 'Facebook content was not accessible'};
    }
    // Even when Facebook changes its markup, provide the correction editor.
    // Avoid fabricating data: failed extractions open with empty editable fields.
    const post = result?.ok ? result : {
      ok: true, pageName: '', text: '', avatarURL: null,
      timestamp: {date:null,time:null,accuracy:'not available'},
      warning: 'Automatic extraction failed: ' + (result?.error || 'unknown error') + '. Fill in the missing fields before saving.',
      manualMode: true
    };
    if (!post.text?.trim()) post.warning = [post.warning,'Post text is empty. Enter the full post manually before saving.'].filter(Boolean).join(' ');
    post.url = tab.url;
    // Session storage, not persistent local storage, so sensitive post content is not saved to disk.
    const key = 'post_' + crypto.randomUUID();
    await chrome.storage.session.set({[key]: post});
    await chrome.tabs.create({url: chrome.runtime.getURL('report.html') + '?id=' + encodeURIComponent(key)});
    setStatus('Post extracted. Opening PDF preview…');
    window.close();
  } catch (err) {
    setStatus(err?.message || String(err), true);
  } finally {
    btn.disabled = false;
  }
});
