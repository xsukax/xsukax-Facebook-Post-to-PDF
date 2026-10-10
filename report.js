'use strict';
const qs = id => document.getElementById(id);
const info = qs('notice');
let payload, original, avatarRequest = 0, pendingAvatar = Promise.resolve();

function displayDate(timestamp) {
  if (!timestamp?.date) return 'Publication date unavailable';
  const match = /^(\d{4})-(\d\d)-(\d\d)$/.exec(timestamp.date);
  let date = timestamp.date;
  if (match) {
    const d = new Date(+match[1], +match[2] - 1, +match[3], 12);
    date = d.toLocaleDateString(undefined, {month:'long',day:'numeric',year:'numeric'});
  }
  if (timestamp.time) date += ' · ' + timestamp.time;
  if (/approximate|inferred/i.test(timestamp.accuracy || '')) date += ' (approx.)';
  return date;
}
function avatarInitial(name) {
  const plain = (name || '').trim();
  if (!plain) return 'F';
  const unit = typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(plain)[Symbol.iterator]().next().value?.segment
    : Array.from(plain)[0];
  return (unit || 'F').toLocaleUpperCase();
}
function validAvatarURL(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && /(?:^|\.)fbcdn\.net$/i.test(u.hostname)
      && !/^static\./i.test(u.hostname) && u.href.length < 4096;
  } catch { return false; }
}
function fileAsDataURL(file) {
  return new Promise((resolve,reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Image could not be read.'));
    r.readAsDataURL(file);
  });
}
function setAvatarPhoto(dataURI) {
  const image = qs('avatar-image');
  const letter = qs('avatar-letter');
  if (dataURI) {
    image.src = dataURI;
    image.hidden = false;
    letter.hidden = true;
  } else {
    image.removeAttribute('src');
    image.hidden = true;
    letter.hidden = false;
  }
}
async function refreshAvatar(value) {
  const token = ++avatarRequest;
  const url = value.trim();
  payload.avatarURL = url || null;
  payload.avatarData = null;
  setAvatarPhoto(null);
  const state = qs('avatar-status');
  if (!url) { state.textContent = 'Initial-letter avatar used.'; return; }
  if (!validAvatarURL(url)) {
    state.textContent = 'Only HTTPS Facebook CDN (fbcdn.net) images are accepted.';
    return;
  }
  state.textContent = 'Loading the page profile photo…';
  try {
    // This request is made from the extension preview, with a narrowly scoped
    // fbcdn.net host permission. No third-party proxy or remote processing.
    const response = await fetch(url, {credentials:'omit', redirect:'follow'});
    if (!response.ok) throw new Error('HTTP ' + response.status);
    if (!validAvatarURL(response.url)) throw new Error('Image redirected outside Facebook CDN');
    const kind = response.headers.get('content-type') || '';
    if (!/^image\/(?:png|jpeg|webp|gif)(?:\s*;|$)/i.test(kind)) throw new Error('URL did not return a supported image');
    const blob = await response.blob();
    if (blob.size > 3 * 1024 * 1024) throw new Error('Image larger than 3 MB');
    const dataURI = await fileAsDataURL(blob);
    if (token !== avatarRequest) return;
    await new Promise((resolve,reject) => {
      const test = new Image(); test.onload=resolve; test.onerror=()=>reject(new Error('Invalid image'));
      test.src=dataURI;
    });
    if (token !== avatarRequest) return;
    payload.avatarData = dataURI;
    setAvatarPhoto(dataURI);
    state.textContent = 'Original page photo loaded and will be included in the PDF.';
  } catch (err) {
    if (token !== avatarRequest) return;
    state.textContent = 'Profile photo unavailable (' + (err?.message || 'loading failed') + '). Using initial instead.';
  }
}
function updatePreview() {
  const pageName = qs('edit-name').value;
  const date = qs('edit-date').value;
  const time = qs('edit-time').value.trim();
  const postText = qs('edit-text').value;
  const previous = payload.timestamp || {};
  const manuallyChanged = date !== (original.timestamp?.date || '')
    || time !== (original.timestamp?.time || '').trim();
  payload.pageName = pageName;
  payload.timestamp = {date:date || null,time:time || null,
    accuracy:manuallyChanged ? 'manual correction' : previous.accuracy};
  payload.text = postText;
  qs('page-name').textContent = pageName.trim() || 'Unknown Facebook page';
  qs('avatar-letter').textContent = avatarInitial(pageName);
  qs('date').textContent = displayDate(payload.timestamp);
  qs('post-text').textContent = postText;
  const count = Array.from(postText).length;
  qs('character-count').textContent = count.toLocaleString() + ' characters';
}
function populateEditor(data) {
  qs('edit-name').value = data.pageName || '';
  qs('edit-date').value = /^\d{4}-\d{2}-\d{2}$/.test(data.timestamp?.date || '') ? data.timestamp.date : '';
  qs('edit-time').value = data.timestamp?.time || '';
  qs('edit-text').value = data.text || '';
  qs('edit-avatar-url').value = data.avatarURL || '';
  updatePreview();
  pendingAvatar = refreshAvatar(qs('edit-avatar-url').value);
}
async function initialize() {
  const id = new URLSearchParams(location.search).get('id');
  if (!id || !/^post_[\w-]+$/.test(id)) throw new Error('No extraction identifier found. Reopen the Facebook post and extract again.');
  const stored = await chrome.storage.session.get(id);
  payload = stored[id];
  if (!payload?.ok || typeof payload.text !== 'string') throw new Error('The extracted post is not in this browser session. Extract it again.');
  if (!/^https:\/\/(?:www\.|web\.|m\.)?facebook\.com\//i.test(payload.url || '')) throw new Error('The recorded URL is not a Facebook post.');
  original = structuredClone(payload);
  const link = qs('source');
  link.href = payload.url;
  link.textContent = payload.url;
  qs('report').hidden = false;
  qs('editor').hidden = false;
  populateEditor(original);
  const warnings = [];
  if (!original.timestamp?.date) warnings.push('Date not detected: enter the correct publication date below.');
  if (!original.text?.trim()) warnings.push('Post text not detected: paste the complete text below.');
  if (original.warning) warnings.push(original.warning);
  info.className = 'notice no-print ' + (warnings.length ? 'warning' : '');
  info.textContent = warnings.length ? warnings.join(' ') : 'Review and correct the fields, then export your PDF.';

  for (const id of ['edit-name','edit-date','edit-time','edit-text']) qs(id).addEventListener('input',updatePreview);
  qs('edit-avatar-url').addEventListener('change',() => {pendingAvatar = refreshAvatar(qs('edit-avatar-url').value);});
  qs('reset').addEventListener('click',() => {populateEditor(original); info.className='notice no-print';info.textContent='Original extracted values restored.';});

  qs('download').addEventListener('click',async()=>{
    updatePreview();
    if (!payload.pageName.trim() || !payload.text.trim()) {
      info.className='notice error no-print'; info.textContent='Please enter a page name and post text before downloading.'; return;
    }
    const button=qs('download'); button.disabled=true;
    info.className='notice no-print';info.textContent='Creating PDF locally…';
    try {
      await pendingAvatar;
      await window.PostPdfExport.download(payload,msg=>{info.textContent=msg;});
      info.textContent='PDF download started. Check your browser downloads.';
    } catch(err){info.textContent='Could not create PDF: '+(err?.message||String(err)); info.className='notice error no-print';}
    finally{button.disabled=false;}
  });
  qs('print').addEventListener('click',async()=>{
    updatePreview();
    if (!payload.pageName.trim() || !payload.text.trim()) {
      info.className='notice error no-print';info.textContent='Please enter a page name and post text before printing.';return;
    }
    await pendingAvatar;
    window.print();
  });
}
initialize().catch(err=>{info.textContent=err.message;info.className='notice error no-print';});
