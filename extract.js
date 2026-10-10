/* Executes only on the Facebook tab after a direct user action. No network access. */
(async () => {
  'use strict';
  const now = new Date();
  const clean = s => String(s ?? '').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim();
  const attr = (node, name) => node?.getAttribute?.(name) || '';
  const visible = el => !!(el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  const text = el => (el?.innerText ?? el?.textContent ?? '').trim();
  const first = (root, selectors) => {
    for (const selector of selectors) {
      const found = Array.from(root.querySelectorAll(selector)).find(visible);
      if (found) return found;
    }
    return null;
  };
  const matchingPostLink = href => {
    try {
      const u = new URL(href, location.href);
      return /(?:^|\.)facebook\.com$/i.test(u.hostname) &&
        (/\/(?:posts|permalink|reel|videos)\//i.test(u.pathname) ||
         /\/share\/(?:p|v|r)\//i.test(u.pathname) ||
         /\/groups\/[^/]+\/permalink\//i.test(u.pathname) ||
         /\/(?:story|photo)\.php$/i.test(u.pathname) ||
         /\/watch\//i.test(u.pathname) || (u.pathname === '/photo' && u.searchParams.has('fbid')));
    } catch { return false; }
  };
  const onPostPage = matchingPostLink(location.href) || /\/pfbid[a-zA-Z0-9]+/i.test(location.pathname);
  if (!onPostPage) {
    return {ok: false, error: 'Open an individual Facebook post using its timestamp/permalink, rather than the main feed.'};
  }
  function chooseRoot() {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(visible);
    const withPost = dialogs.find(d => d.querySelector('[data-ad-comet-preview="message"], [data-ad-preview="message"], [role="article"]'));
    if (withPost) return withPost;
    const articles = [...document.querySelectorAll('[role="article"]')].filter(visible);
    if (articles.length === 1) return articles[0];
    if (articles.length > 1) {
      const here = location.pathname.split('/').filter(Boolean).pop();
      const byUrl = articles.filter(a => [...a.querySelectorAll('a[href]')].some(link =>
        matchingPostLink(link.href) && (link.href.includes(here) || link.href === location.href)));
      if (byUrl.length === 1) return byUrl[0];
      return null; // Never silently capture a different post from a busy feed.
    }
    if (dialogs.length === 1) return dialogs[0];
    return document.querySelector('[role="main"]') || document.querySelector('main') || document.body;
  }
  const root = chooseRoot();
  if (!root) return {ok:false, error:'Multiple posts were found and the displayed post could not be identified. Open its direct link.'};

  // The supplied Facebook View Source samples have no hydrated post DOM. However,
  // their <title> identifies the author on EITHER side of " - ":
  //   "Post excerpt... - Office of the Prime Minister-Ethiopia"
  //   "Firstpost - Ethiopia has launched a National Precious Metals..."
  // Do not mistake a visible accessibility link (e.g. "Online status indicator Active")
  // for the author just because Facebook made it the first link in the article.
  const documentTitle = clean(document.title);
  const headerNode = first(root, ['h2', 'h3', 'header']);
  const uiLabel = /^(?:online status indicator(?:\s+active)?|active|inactive|verified|unverified|facebook|menu|profile picture|see more|like|comment|share|follow|send|reply|message|photos?|videos?|reels?|more|notifications?|search|home|view profile)$/i;
  const isUiLabel = value => uiLabel.test(value) || /^(?:online status|status indicator|active now|last active|\d+\s+(?:comments?|shares?|likes?))\b/i.test(value);

  function normalizeExcerpt(value) {
    return clean(value).replace(/(?:\.{3}|…)+$/u,'').replace(/\s+/gu,' ').toLocaleLowerCase();
  }
  function pageFromTitle(titleText) {
    // Don't split on plain hyphens inside the page name, e.g. "Minister-Ethiopia".
    let parts = titleText.split(/\s+[-–—]\s+/u).map(clean).filter(Boolean);
    if (parts.length > 2 && /^facebook$/i.test(parts[parts.length-1])) parts.pop();
    if (parts.length < 2) return null;
    const left = parts[0], right = parts.slice(1).join(' - ');
    const excerptPattern = /(?:\.{3}|…)\s*$/u;
    // When one side is a truncated post excerpt, the other side is the page name.
    if (excerptPattern.test(left) && !excerptPattern.test(right) && !isUiLabel(right)) return right;
    if (excerptPattern.test(right) && !excerptPattern.test(left) && !isUiLabel(left)) return left;
    return {left,right};  // Resolve ambiguous titles by comparing against post text later.
  }

  // Restrict author fallback to actual profile links. Avoid story timestamps,
  // reaction links, online-status indicators, avatar accessibility labels, etc.
  function profileLink(href) {
    try {
      const u = new URL(href, location.href);
      if (!/(?:^|\.)facebook\.com$/i.test(u.hostname) || matchingPostLink(u.href)) return false;
      const path = u.pathname.replace(/\/+$/,'');
      if (/^\/(?:profile\.php|people\/[^/]+\/\d+|pages\/[^/]+\/\d+)$/i.test(path)) return true;
      return /^\/[\w.%-]{2,100}$/u.test(path) && !/^\/(?:login|home|watch|reel|groups|events|marketplace|search|notifications|messages|settings|help|friends|stories|gaming|photo|photos|videos|posts|share)$/i.test(path);
    } catch {return false;}
  }
  const titleParts = pageFromTitle(documentTitle);
  const titlePage = typeof titleParts === 'string' ? titleParts : null;
  const candidates=[];
  for (const el of root.querySelectorAll('h1 a[href], h2 a[href], h3 a[href], header a[href], strong a[href], a[role="link"][href]')) {
    if (!visible(el)) continue;
    const label = clean(text(el));
    if (!label || label.length > 180 || isUiLabel(label) || !profileLink(attr(el,'href'))) continue;
    if (el.closest('[role="listitem"], [data-testid="comment"], [role="menu"], [role="navigation"], nav, footer')) continue;
    let score=0;
    if (el.closest('h1,h2,h3')) score+=100;
    if (el.closest('header')) score+=35;
    if (el.closest('strong')) score+=20;
    if (titlePage && label.toLocaleLowerCase() === titlePage.toLocaleLowerCase()) score+=150;
    if (/\/profile\.php|\/people\//.test(el.href)) score+=10;
    candidates.push({el,label,score});
  }
  candidates.sort((a,b)=>b.score-a.score);
  const candidateAuthor = candidates[0] || null;

  function messageNode() {
    const selectors = [
      '[data-ad-comet-preview="message"]', '[data-ad-preview="message"]',
      '[data-testid="post_message"]', '[data-testid*="post_message"]',
      '[data-testid="post-body"]', '[itemprop="articleBody"]'
    ];
    for (const selector of selectors) {
      const candidates = [...root.querySelectorAll(selector)].filter(visible);
      // Avoid text belonging to nested articles (shared post/comment).
      const best = candidates.find(el => text(el).length > 0 && !el.closest('[role="listitem"], [data-testid="comment"]'));
      if (best) return {node:best, strategy:selector};
    }
    // Fallback for Comet markup without stable attributes: score visible text-only blocks,
    // excluding comment lists, navigation, the author header, and social controls.
    const candidates = [...root.querySelectorAll('[dir="auto"], [dir="ltr"], [dir="rtl"]')]
      .filter(el => visible(el) && !el.closest('nav,footer,[role="listitem"],[data-testid="comment"],[role="menu"],[role="navigation"]'))
      .filter(el => !candidateAuthor?.el?.contains(el) && !(headerNode?.contains(el) && text(el).length < 150))
      .map(el => {
        const value = text(el);
        if (!value || value.length < 16 || value.length > 120000) return null;
        if (/^(?:like|comment|share|send|follow|write a comment|see more|most relevant|all comments)$/i.test(value)) return null;
        const links = el.querySelectorAll('a').length;
        const buttons = el.querySelectorAll('button,[role="button"]').length;
        const lines = value.split('\n').length;
        const score = Math.min(value.length, 10000) + Math.min(lines, 15) * 12 - buttons * 120 - links * 20;
        return {el, value, score};
      }).filter(Boolean).sort((a,b) => b.score-a.score);
    if (candidates.length && candidates[0].score >= 20) return {node:candidates[0].el, strategy:'visible text block heuristic'};
    return {node:null, strategy:'none'};
  }
  const message = messageNode();
  let postText = message.node ? text(message.node) : '';
  const expandLabel = /^(?:\.\.\.\s*)?(?:see more|read more|عرض المزيد|إظهار المزيد|المزيد|ተጨማሪ ይመልከቱ)$/i;
  // Only expand buttons inside the actual post text (never comments or recommendations).
  if (message.node) {
    const expansionScope = message.node.parentElement || message.node;
    const expanders = [...expansionScope.querySelectorAll('[role="button"],button')]
      .filter(el => visible(el) && expandLabel.test(clean(text(el) || attr(el,'aria-label'))));
    if (expanders.length) {
      for (const button of expanders.slice(0,3)) button.click();
      await new Promise(resolve => setTimeout(resolve,250));
      postText = text(message.node);
    }
    const stillCollapsed = [...expansionScope.querySelectorAll('[role="button"],button')]
      .some(el => visible(el) && expandLabel.test(clean(text(el) || attr(el,'aria-label'))));
    if (stillCollapsed || /(?:^|\n|\s)(?:See more|Read more|عرض المزيد|إظهار المزيد)\s*$/i.test(postText)) {
      return {ok:false, error:'The post still appears collapsed. Click “See more” on Facebook, then retry.'};
    }
  }

  // Source-title precedence is deliberate: it prevents Facebook UI labels from
  // overriding the actual publisher, as happened with the supplied Firstpost URL.
  function resolvedPageName() {
    if (titlePage) return titlePage;
    if (titleParts && typeof titleParts === 'object') {
      const posted=normalizeExcerpt(postText);
      const left=normalizeExcerpt(titleParts.left), right=normalizeExcerpt(titleParts.right);
      const leftIsExcerpt=posted && left.length>=15 && posted.startsWith(left);
      const rightIsExcerpt=posted && right.length>=15 && posted.startsWith(right);
      if (leftIsExcerpt && !rightIsExcerpt && !isUiLabel(titleParts.right)) return titleParts.right;
      if (rightIsExcerpt && !leftIsExcerpt && !isUiLabel(titleParts.left)) return titleParts.left;
    }
    return candidateAuthor?.label || null;
  }
  const pageName=resolvedPageName();

  function localISO(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  const clock = d => d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
  const makeDate = (d, raw, accuracy, includeTime = true) =>
    Number.isNaN(d.getTime()) ? null :
      {date:localISO(d),time:includeTime ? clock(d) : null,raw,accuracy};

  // The publication date is often a visible text/ARIA descendant of a Comet
  // header, NOT <time> and NOT an <a> pointing to the post permalink.
  function interpretDate(input, kind = '') {
    const raw = clean(input).replace(/[\u00a0\u202f]/g,' ').replace(/\s+/g,' ').trim();
    if (!raw || raw.length > 160) return null;
    const epoch = Number(raw);
    if (kind === 'epoch' && Number.isFinite(epoch) && epoch > 1000000000) {
      const d = new Date(epoch >= 100000000000 ? epoch : epoch * 1000);
      return makeDate(d,raw,'exact timestamp');
    }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/i.test(raw)) {
      return makeDate(new Date(raw),raw,'exact timestamp');
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const [y,m,d]=raw.split('-').map(Number);
      const check = new Date(y,m-1,d);
      if (check.getFullYear()===y && check.getMonth()===m-1 && check.getDate()===d)
        return {date:raw,time:null,raw,accuracy:'explicit calendar date'};
      return null;
    }

    // FB relative timestamps can be 'Just now', '2h', '2 h', or localized labels.
    if (/^(?:just\s*now|right\s*now|now|a\s*(?:few\s*)?(?:moments?|seconds?)\s*ago|moments?\s*ago|just\s*posted|الآن|الان|حالاً|حالا|للتو|منذ\s*لحظات|قبل\s*لحظات|በአሁኑ\s*ሰዓት|አሁን)$/iu.test(raw))
      return makeDate(now,raw,'approximate (recent post)');

    const today=raw.match(/^today(?:\s+at\s+(.+))?$/i);
    if (today) return {date:localISO(now),time:today[1]||null,raw,accuracy:'calendar date displayed as today'};
    const yesterday=raw.match(/^yesterday(?:\s+at\s+(.+))?$/i);
    if (yesterday || /^(?:أمس|ትናንት)$/iu.test(raw)) {
      const d = new Date(now);
      d.setDate(d.getDate()-1);
      return {date:localISO(d),time:yesterday?.[1]||null,raw,accuracy:'relative calendar day'};
    }
    if (/^(?:a\s+)?few\s+(?:seconds?|minutes?)\s+ago$/i.test(raw))
      return makeDate(now,raw,'approximate (recent post)');
    const normalized=raw.replace(/^(?:about|approximately)\s+/i,'')
      .replace(/^(?:a|an|one)\s+(?=second|minute|min|hour|day|week)/i,'1 ')
      .replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-0x0660))
      .replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-0x06f0));
    const rel=normalized.match(/^(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|min|m|hours?|hrs?|hr|h|days?|d|weeks?|w|ثواني|ثانية|دقائق|دقيقة|ساعات|ساعة|أيام|يوم|أسابيع|أسبوع|ሰከንዶች?|ደቂቃዎች?|ሰዓታት|ቀናት)\s*(?:ago|منذ|በፊት)?$/iu);
    if(rel) {
      const n=Number(rel[1]),u=rel[2].toLowerCase();
      let ms=null;
      if (/^(?:seconds?|secs?|s|ثواني|ثانية|ሰከንዶች?)$/u.test(u)) ms=1000;
      else if(/^(?:minutes?|mins?|min|m|دقائق|دقيقة|ደቂቃዎች?)$/u.test(u))ms=60000;
      else if(/^(?:hours?|hrs?|hr|h|ساعات|ساعة|ሰዓታት)$/u.test(u))ms=3600000;
      else if(/^(?:days?|d|أيام|يوم|ቀናት)$/u.test(u))ms=86400000;
      else if(/^(?:weeks?|w|أسابيع|أسبوع)$/u.test(u))ms=604800000;
      if(ms!==null && n>=0 && n<200000)
        return makeDate(new Date(now.getTime()-n*ms),raw,'derived from relative duration (approximate)');
    }
    // Explicit numeric dates where the year is present; reject ambiguous
    // day/month ordering unless browser locale, or values >12, resolve it.
    const slash=raw.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})(?:\s+(?:at\s+)?(\d{1,2}:\d{2}(?:\s*[AP]M)?))?$/i);
    if(slash) {
      let a=+slash[1],b=+slash[2],y=+slash[3];
      const us=/^en-US\b/i.test(navigator.language||'');
      if(a<=12&&b<=12&&!us) { // Most non-US Facebook dates use day/month.
        const d=new Date(y,b-1,a);
        return d.getFullYear()===y && d.getDate()===a && d.getMonth()===b-1
          ? {date:localISO(d),time:slash[4]||null,raw,accuracy:'explicit numeric calendar date (day-first locale)'} : null;
      }
      const month=a>12 ? b : (b>12 ? a : a);
      const day=a>12 ? a : (b>12 ? b : b);
      const d=new Date(y,month-1,day);
      return d.getFullYear()===y && d.getMonth()===month-1 && d.getDate()===day
        ? {date:localISO(d),time:slash[4]||null,raw,accuracy:'explicit numeric calendar date'} : null;
    }
    // 'October 8 at 7:03 PM', '8 October at 19:03' and full tooltip dates.
    const monthName=/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;
    if(monthName.test(raw) && /\d{1,2}/.test(raw)) {
      const hasYear=/\b(?:19|20)\d{2}\b/.test(raw);
      const prepared=raw.replace(/\s+at\s+/i,' ').replace(/\s+·\s+/g,' ');
      let candidate=hasYear ? prepared : `${prepared} ${now.getFullYear()}`;
      let d=new Date(candidate);
      if (Number.isNaN(d.getTime())) return null;
      if(!hasYear && d.getTime()>now.getTime()+36*3600000)
        d=new Date(`${prepared} ${now.getFullYear()-1}`);
      const hasClock=/\d{1,2}:\d{2}|\d{1,2}\s*[AP]M/i.test(raw);
      return makeDate(d,raw,hasYear?'parsed calendar date':'year inferred from current date',hasClock);
    }
    return null;
  }

  function parseLabel(label, kind = '') {
    if (!label) return null;
    const raw=clean(label);
    let parsed=interpretDate(raw,kind);
    if(parsed)return parsed;
    // Facebook may append its visibility text to the same accessibility label:
    // e.g. "3h · Public post" or "Yesterday at 5 PM · Shared with Public".
    const fragments=raw.split(/\s*[·•|\n]\s*/u)
      .map(part=>part.replace(/^(?:posted|published|shared)\s+(?:on|at)\s+/i,'').trim());
    for(const part of fragments) {
      if(!part || part===raw) continue;
      parsed=interpretDate(part,kind);
      if(parsed)return parsed;
    }
    return null;
  }

  function publicationDate() {
    // meta may contain a precise publication instant; verify against the post
    // rather than a date from navigation or a sidebar.
    const metaKeys=['meta[property="article:published_time"]', 'meta[itemprop="datePublished"]',
      'meta[property="og:published_time"]'];
    for(const selector of metaKeys) {
      const value=attr(document.querySelector(selector),'content');
      const result=parseLabel(value);
      if(result)return result;
    }

    const all=[...root.querySelectorAll('*')].slice(0,3500);
    const positions=new Map(all.map((el,i)=>[el,i]));
    const authorPosition=candidateAuthor ? positions.get(candidateAuthor.el) : undefined;
    const messagePosition=message.node ? positions.get(message.node) : undefined;
    const header=headerNode?.closest('header') || candidateAuthor?.el?.closest('header');
    const candidates=[];
    const evaluated=new Set();
    function record(el, includePlainText=false) {
      if(!el || evaluated.has(el) || !visible(el))return;
      evaluated.add(el);
      if(el.closest('[role="listitem"], [data-testid="comment"], [role="navigation"], nav, footer, [role="menu"]'))return;
      if(message.node && (message.node===el || message.node.contains(el)))return;
      const index=positions.get(el);
      if(index===undefined) return;
      // Capturing a commenter or 'suggested post' timestamp would falsify the
      // archive. Date candidates must be in the author/header region.
      if(messagePosition!==undefined && index>messagePosition+10)return;
      if(authorPosition!==undefined && Math.abs(index-authorPosition)>180)return;
      if(authorPosition===undefined && index>350 && !header?.contains(el))return;
      const permalink=el.matches('a[href]') && matchingPostLink(el.href);
      const structured=el.matches('time,abbr,[data-utime],[datetime]');
      const closeHeader=!!header?.contains(el);
      const nearAuthor=authorPosition===undefined ? Math.max(0,110-index) :
        Math.max(0,120-Math.abs(index-authorPosition));
      const weight=nearAuthor/10+(closeHeader?28:0)+(permalink?35:0)+(structured?30:0);
      for(const [raw,kind,base] of [
        [attr(el,'data-utime'),'epoch',120], [attr(el,'data-time'),'epoch',115],
        [attr(el,'data-timestamp'),'epoch',110], [attr(el,'datetime'),'iso',105],
        [attr(el,'data-tooltip-content'),'label',95], [attr(el,'title'),'label',90],
        [attr(el,'aria-label'),'label',85], [attr(el,'data-content'),'label',75],
        [includePlainText ? text(el) : '','text',55]
      ]) {
        const date=parseLabel(raw,kind);
        if(!date)continue;
        const confidence=date.accuracy==='exact timestamp'?45:0;
        candidates.push({date,score:base+weight+confidence,index});
      }
    }

    // First pass: explicitly marked dates and post links (including aria-labels
    // on nested descendants, not only on the anchor itself).
    for(const el of all) {
      if(el.matches('time,abbr,[data-utime],[datetime],a[href], [data-tooltip-content], [aria-label], [title], [data-time], [data-timestamp]'))
        record(el,true);
    }
    // Second pass: Comet sometimes renders the timestamp as just a text span
    // beside the page name. Restrict this search to the post's header region.
    for(const el of all) {
      if(!el.matches('span,[role="link"],[role="button"]'))continue;
      const index=positions.get(el);
      if(authorPosition!==undefined && Math.abs(index-authorPosition)>140)continue;
      if(authorPosition===undefined && index>260)continue;
      if(el.childElementCount>3 || text(el).length>100)continue;
      record(el,true);
    }
    candidates.sort((a,b)=>b.score-a.score || a.index-b.index);
    if(candidates.length)return candidates[0].date;
    return {date:null,time:null,raw:null,accuracy:'not available'};
  }

  // Locate the actual publisher profile image, not the post attachment or a
  // commenter avatar. Facebook uses both HTML <img> and SVG <image href=...>.
  // Never use og:image here: it generally represents the POST media.
  function authorAvatarURL() {
    const valid = raw => {
      try {
        const u = new URL(raw, location.href);
        return u.protocol === 'https:' && /(?:^|\.)fbcdn\.net$/i.test(u.hostname)
          && !/^static\./i.test(u.hostname) && u.href.length < 4096 ? u.href : null;
      } catch { return null; }
    };
    const imgURL = el => {
      if (el.localName === 'image') return valid(el.getAttribute('href') || el.getAttribute('xlink:href'));
      if (el.localName === 'img') return valid(el.currentSrc || el.getAttribute('src'));
      // Some profile circles are rendered with inline CSS background images.
      if ((el.getAttribute('style') || '').includes('background-image')) {
        const css = getComputedStyle(el).backgroundImage;
        const match = /^url\(["']?(.*?)["']?\)$/i.exec(css);
        if (match) return valid(match[1]);
      }
      return null;
    };
    const header = candidateAuthor?.el?.closest('header')
      || headerNode?.closest('header')
      || root.querySelector('header');
    const scopes = [];
    if (candidateAuthor?.el) {
      let cur = candidateAuthor.el;
      for (let depth = 0; depth < 5 && cur && root.contains(cur); depth++, cur = cur.parentElement) {
        if (!scopes.includes(cur)) scopes.push(cur);
        if (cur === header) break;
      }
    }
    if (header && !scopes.includes(header)) scopes.push(header);
    // Some Comet posts don't use <header>; only inspect the beginning of the
    // article, never its media area below the post text.
    if (!scopes.length) scopes.push(root);
    const candidates = [], seen = new Set();
    for (let depth = 0; depth < scopes.length; depth++) {
      const scope = scopes[depth];
      const items = [...scope.querySelectorAll('img, svg image, [style*="background-image"]')].slice(0,65);
      for (const el of items) {
        if (seen.has(el)) continue;
        seen.add(el);
        if (!visible(el) || el.closest('[role="listitem"], [data-testid="comment"], nav, footer, [role="menu"]')) continue;
        if (message.node && (message.node === el || message.node.contains(el))) continue;
        const url = imgURL(el);
        if (!url) continue;
        const rect = el.getBoundingClientRect();
        const size = Math.max(rect.width,rect.height);
        if (size < 22 || size > 180 || Math.min(rect.width,rect.height) < 18) continue;
        const ratio = rect.width / Math.max(rect.height,1);
        if (ratio < .65 || ratio > 1.55) continue;
        const ownerLink = el.closest('a[href]');
        let score = 130 - depth*12;
        if (header?.contains(el)) score += 75;
        if (ownerLink && candidateAuthor?.el && ownerLink.getAttribute('href') === candidateAuthor.el.getAttribute('href')) score += 100;
        if (ownerLink && profileLink(attr(ownerLink,'href'))) score += 35;
        if (/(?:profile|avatar|page photo|profile picture)/i.test([attr(el,'alt'),attr(el,'aria-label'),attr(ownerLink,'aria-label')].join(' '))) score += 25;
        if (size >= 32 && size <= 85) score += 25;
        if (candidateAuthor?.el && visible(candidateAuthor.el)) {
          const a = candidateAuthor.el.getBoundingClientRect();
          const distance = Math.hypot((rect.left+rect.width/2)-(a.left+a.width/2),(rect.top+rect.height/2)-(a.top+a.height/2));
          if (distance < 160) score += 65;
          else if (distance > 350) score -= 100;
        }
        if (!header && !candidateAuthor && depth === 0) score -= 150;
        candidates.push({url,score});
      }
    }
    candidates.sort((a,b) => b.score - a.score);
    return candidates[0]?.score >= 90 ? candidates[0].url : null;
  }
  const avatarURL = authorAvatarURL();
  const timestamp = publicationDate();
  return {
    ok:true, pageName, timestamp, text:postText, avatarURL,
    url:location.href, capturedAt:now.toISOString(), extractionMethod:message.strategy,
    warning: message.strategy === 'visible text block heuristic'
      ? 'Post text was identified heuristically. Compare it against the post before saving.' : null
  };
})();
