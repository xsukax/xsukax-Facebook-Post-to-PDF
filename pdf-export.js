/*
 * No external dependencies. Edge's Canvas shapes Arabic/Amharic using locally
 * installed fonts, and a small PDF writer packages the rendered page images.
 * Direct-download PDFs are visually faithful and include a CLICKABLE source URL.
 * For SELECTABLE text, use the native Print / Save searchable PDF action.
 */
(function () {
  'use strict';
  const W=595.28, H=841.89, SCALE=2.4;
  const CARD={x:40,y:40,w:W-80};
  const LEFT=CARD.x+24, RIGHT=CARD.x+CARD.w-24, CONTENTW=RIGHT-LEFT;
  const LIMIT=H-71;
  const FONT='"Segoe UI","Noto Sans Arabic","Noto Sans Ethiopic",Arial,sans-serif';
  const enc=value=>new TextEncoder().encode(value);
  const decode64=value=>Uint8Array.from(atob(value),char=>char.charCodeAt(0));
  function safeName(data) {
    const page=(data.pageName||'Facebook Post').replace(/[\\/:*?"<>|\x00-\x1f]/g,'-').replace(/\s+/g,' ').slice(0,65).trim();
    return `${page||'Facebook Post'} - ${data.timestamp?.date||'unknown-date'}.pdf`;
  }
  function safeURL(url) {
    try{const u=new URL(url);return u.protocol==='https:' && /(?:^|\.)facebook\.com$/i.test(u.hostname) ? url : null;}
    catch{return null;}
  }
  function pdfHex(value){return Array.from(enc(value),b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();}
  function makePDF(pages) {
    const hasLink=pages.some(p=>p.link);
    const linkId=hasLink?3+pages.length*3:null;
    const total=2+pages.length*3+(hasLink?1:0);
    const chunks=[],offsets=[0];let length=0;
    function add(value){const bytes=typeof value==='string'?enc(value):value;chunks.push(bytes);length+=bytes.length;}
    function begin(i){offsets[i]=length;add(`${i} 0 obj\n`);}
    function end(){add('\nendobj\n');}
    add('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    begin(1);add('<< /Type /Catalog /Pages 2 0 R >>');end();
    begin(2);add(`<< /Type /Pages /Kids [${pages.map((_,i)=>`${3+i*3} 0 R`).join(' ')}] /Count ${pages.length} >>`);end();
    for(let i=0;i<pages.length;i++){
      const obj=3+i*3,img=obj+1,content=obj+2,p=pages[i];
      const annot=p.link && linkId?` /Annots [${linkId} 0 R]`:'';
      begin(obj);add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${img} 0 R >> >> /Contents ${content} 0 R${annot} >>`);end();
      begin(img);add(`<< /Type /XObject /Subtype /Image /Width ${Math.round(W*SCALE)} /Height ${Math.round(H*SCALE)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
      add(p.jpeg);add('\nendstream');end();
      const stream=`q\n${W} 0 0 ${H} 0 0 cm\n/Im0 Do\nQ\n`;
      begin(content);add(`<< /Length ${enc(stream).length} >>\nstream\n${stream}endstream`);end();
    }
    if(hasLink){
      const source=pages.find(p=>p.link).link;
      const {top,bottom}=source;
      begin(linkId);
      add(`<< /Type /Annot /Subtype /Link /Rect [${LEFT} ${H-bottom} ${RIGHT} ${H-top}] /Border [0 0 0] /A << /S /URI /URI <${pdfHex(source.url)}> >> >>`);
      end();
    }
    const xref=length;
    add(`xref\n0 ${total+1}\n0000000000 65535 f \n`);
    for(let i=1;i<=total;i++) add(`${String(offsets[i]).padStart(10,'0')} 00000 n \n`);
    add(`trailer\n<< /Size ${total+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    const out=new Uint8Array(length);let position=0;
    for(const b of chunks){out.set(b,position);position+=b.length;}
    return new Blob([out],{type:'application/pdf'});
  }
  const graphemes=value=>typeof Intl.Segmenter==='function'
    ? Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(value),e=>e.segment)
    : Array.from(value);
  const rtl=value=>{const char=(value.match(/[\p{Script=Arabic}\p{Script=Hebrew}A-Za-z\p{Script=Ethiopic}]/u)||[])[0];return Boolean(char&&/[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(char));};
  function dateString(stamp){
    if(!stamp?.date)return 'Publication date unavailable';
    const m=/^(\d{4})-(\d\d)-(\d\d)$/.exec(stamp.date);
    const date=m?new Date(+m[1],+m[2]-1,+m[3],12).toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'}):stamp.date;
    return date+(stamp.time?' · '+stamp.time:'')+(/approximate|inferred/i.test(stamp.accuracy||'')?' (approx.)':'');
  }
  function initial(name){
    const trimmed=String(name||'').trim();
    return (graphemes(trimmed)[0]||'F').toLocaleUpperCase();
  }
  async function loadAvatar(data) {
    if (typeof data.avatarData !== 'string' ||
        !/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(data.avatarData) ||
        data.avatarData.length > 5 * 1024 * 1024) return null;
    return new Promise(resolve => {
      const image = new Image();
      image.onload = () => resolve(image.naturalWidth && image.naturalHeight ? image : null);
      image.onerror = () => resolve(null);
      image.src = data.avatarData;
    });
  }
  async function renderPages(data,onProgress){
    const avatarImage = await loadAvatar(data);
    const pages=[];let canvas,ctx,y,pageNo=0,link;
    const displayName=data.pageName||'Unknown Facebook page';
    const pubDate=dateString(data.timestamp);
    const url=safeURL(data.url);
    if(!url)throw new Error('The original post URL was missing or invalid.');
    function setFont(size,weight='normal'){ctx.font=`${weight} ${size}px ${FONT}`;}
    function roundRect(x,y,w,h,r){
      if(ctx.roundRect){ctx.beginPath();ctx.roundRect(x,y,w,h,r);return;}
      ctx.beginPath();ctx.rect(x,y,w,h);
    }
    function drawGlobe(x,cy){
      ctx.save();ctx.strokeStyle='#65676b';ctx.lineWidth=.9;ctx.beginPath();ctx.arc(x+5,cy,5,0,Math.PI*2);ctx.moveTo(x,cy);ctx.lineTo(x+10,cy);ctx.moveTo(x+5,cy-5);ctx.bezierCurveTo(x+8,cy-3,x+8,cy+3,x+5,cy+5);ctx.moveTo(x+5,cy-5);ctx.bezierCurveTo(x+2,cy-3,x+2,cy+3,x+5,cy+5);ctx.stroke();ctx.restore();
    }
    function avatar(x,cy,r){
      if (avatarImage) {
        const w=avatarImage.naturalWidth,h=avatarImage.naturalHeight;
        const side=Math.min(w,h), sx=(w-side)/2,sy=(h-side)/2;
        ctx.save();ctx.beginPath();ctx.arc(x,cy,r,0,Math.PI*2);ctx.clip();
        ctx.drawImage(avatarImage,sx,sy,side,side,x-r,cy-r,2*r,2*r);
        ctx.restore();
      } else {
        ctx.fillStyle='#1877f2';ctx.beginPath();ctx.arc(x,cy,r,0,Math.PI*2);ctx.fill();
        ctx.fillStyle='#fff';ctx.textAlign='center';ctx.direction='ltr';setFont(r, 'bold');ctx.fillText(initial(displayName),x,cy+r*.38);ctx.textAlign='left';
      }
    }
    function beginPage(){
      if(canvas)finishPage(false);
      ++pageNo;
      canvas=document.createElement('canvas');
      canvas.width=Math.round(W*SCALE);canvas.height=Math.round(H*SCALE);
      ctx=canvas.getContext('2d',{alpha:false});
      if(!ctx)throw new Error('Canvas unavailable; use the Print / Save searchable PDF option.');
      ctx.setTransform(SCALE,0,0,SCALE,0,0);
      ctx.fillStyle='#f0f2f5';ctx.fillRect(0,0,W,H);
      ctx.fillStyle='#fff';ctx.fillRect(CARD.x,CARD.y,CARD.w,H-CARD.y-40);
      if(pageNo===1){
        avatar(LEFT+21,77,21);
        ctx.fillStyle='#050505';setFont(14,'bold');
        ctx.textAlign='left';ctx.direction='ltr';
        const nameLines=wrap(displayName,14,CONTENTW-88);
        const headerY=76;
        for(let i=0;i<Math.min(2,nameLines.length);i++){
          ctx.fillText(nameLines[i],LEFT+53,headerY+i*17);
        }
        const dateY=headerY+Math.min(2,nameLines.length)*17+1;
        ctx.fillStyle='#65676b';setFont(9);
        const dateLines=wrap(pubDate,9,CONTENTW-90);
        for(let i=0;i<Math.min(dateLines.length,2);i++)ctx.fillText(dateLines[i],LEFT+53,dateY+i*12);
        drawGlobe(LEFT+53+Math.min(ctx.measureText(dateLines[0]||'').width+8,CONTENTW-100),dateY-4);
        ctx.fillStyle='#65676b';setFont(22,'bold');ctx.textAlign='right';ctx.fillText('···',RIGHT,69);ctx.textAlign='left';
        y=Math.max(151,dateY+Math.min(2,dateLines.length)*12+21);
      } else {
        avatar(LEFT+15,74,15);
        ctx.fillStyle='#050505';setFont(11,'bold');
        ctx.fillText(displayName+' · continued',LEFT+40,78);
        y=119;
      }
    }
    function finishPage(isLast){
      const cardEnd=isLast?Math.min(H-41,Math.max(y+20,210)):H-41;
      // Remove the unused white area beneath the final card, leaving a gray canvas.
      if(isLast && cardEnd<H-40){ctx.fillStyle='#f0f2f5';ctx.fillRect(CARD.x,cardEnd,CARD.w,H-cardEnd-40);}
      ctx.strokeStyle='#d4d8df';ctx.lineWidth=.8;roundRect(CARD.x,CARD.y,CARD.w,cardEnd-CARD.y,7);ctx.stroke();
      const dataURL=canvas.toDataURL('image/jpeg',.93);
      pages.push({jpeg:decode64(dataURL.slice(dataURL.indexOf(',')+1)),link});
      canvas.width=0;canvas.height=0;canvas=null;ctx=null;link=null;
    }
    function ensure(height){if(y+height>LIMIT)beginPage();}
    function wrap(input,size,maxWidth=CONTENTW){
      const value=String(input);
      if(!value)return [''];
      setFont(size);
      const tokens=value.match(/\s+|\S+/gu)||[value],out=[];
      let line='';
      const split=(token)=>{
        let part='';
        for(const unit of graphemes(token)){
          if(part&&ctx.measureText(part+unit).width>maxWidth){out.push(part);part=unit;}
          else part+=unit;
        }
        return part;
      };
      for(const token of tokens){
        if(ctx.measureText(line+token).width<=maxWidth){line+=token;continue;}
        if(line){out.push(line);line='';}
        if(ctx.measureText(token).width<=maxWidth)line=token;
        else line=split(token);
      }
      if(line)out.push(line);
      return out.length?out:[''];
    }
    function line(input,size=11.4,height=18.7,color='#050505'){
      const sublines=wrap(input,size);
      for(const segment of sublines){
        ensure(height);
        ctx.fillStyle=color;setFont(size);
        if(rtl(segment)){ctx.textAlign='right';ctx.direction='rtl';ctx.fillText(segment,RIGHT,y);}
        else{ctx.textAlign='left';ctx.direction='ltr';ctx.fillText(segment,LEFT,y);}
        y+=height;
      }
      ctx.textAlign='left';ctx.direction='ltr';
    }
    function actionIcon(kind,x,cy){
      ctx.save();ctx.strokeStyle='#65676b';ctx.lineWidth=1.3;ctx.lineJoin='round';ctx.lineCap='round';
      if(kind==='Like'){
        ctx.beginPath();ctx.moveTo(x,cy+5);ctx.lineTo(x+3,cy+5);ctx.lineTo(x+3,cy-2);ctx.lineTo(x,cy-2);ctx.closePath();ctx.stroke();
        ctx.beginPath();ctx.moveTo(x+4,cy-2);ctx.lineTo(x+7,cy-7);ctx.lineTo(x+8,cy-7);ctx.lineTo(x+8,cy-2);ctx.lineTo(x+13,cy-2);ctx.lineTo(x+12,cy+5);ctx.lineTo(x+4,cy+5);ctx.closePath();ctx.stroke();
      }else if(kind==='Comment'){
        ctx.beginPath();ctx.moveTo(x+1,cy-5);ctx.lineTo(x+12,cy-5);ctx.quadraticCurveTo(x+14,cy-5,x+14,cy-3);ctx.lineTo(x+14,cy+3);ctx.quadraticCurveTo(x+14,cy+5,x+12,cy+5);ctx.lineTo(x+6,cy+5);ctx.lineTo(x+2,cy+8);ctx.lineTo(x+3,cy+5);ctx.quadraticCurveTo(x,cy+5,x,cy+3);ctx.lineTo(x,cy-3);ctx.quadraticCurveTo(x,cy-5,x+1,cy-5);ctx.stroke();
      }else{
        ctx.beginPath();ctx.moveTo(x,cy+5);ctx.lineTo(x+12,cy-6);ctx.moveTo(x+7,cy-6);ctx.lineTo(x+12,cy-6);ctx.lineTo(x+12,cy-1);ctx.stroke();
      }
      ctx.restore();
    }
    function drawActions(){
      const rowHeight=49;
      ensure(rowHeight+67);
      y+=12;
      ctx.strokeStyle='#e4e6eb';ctx.lineWidth=.8;
      ctx.beginPath();ctx.moveTo(LEFT,y);ctx.lineTo(RIGHT,y);ctx.stroke();
      const items=['Like','Comment','Share'];
      items.forEach((name,i)=>{
        const x=LEFT+64+i*(CONTENTW/3);
        actionIcon(name,x-26,y+22);
        ctx.fillStyle='#65676b';setFont(10,'bold');ctx.textAlign='center';ctx.direction='ltr';ctx.fillText(name,x+21,y+26);
      });
      ctx.textAlign='left';y+=rowHeight;
    }
    function drawURL(){
      const label='ORIGINAL FACEBOOK POST URL';
      const linkLines=wrap(url,8.8,CONTENTW);
      const height=45+14.4*linkLines.length;
      ensure(height+12);
      const start=y;
      ctx.fillStyle='#f7f8fa';ctx.fillRect(CARD.x+1,start,CARD.w-2,height);
      ctx.strokeStyle='#e4e6eb';ctx.lineWidth=.8;ctx.beginPath();ctx.moveTo(CARD.x+1,start);ctx.lineTo(CARD.x+CARD.w-1,start);ctx.stroke();
      ctx.fillStyle='#65676b';setFont(8.5,'bold');ctx.fillText(label,LEFT,start+20);
      ctx.fillStyle='#0866ff';setFont(8.8);
      linkLines.forEach((part,i)=>ctx.fillText(part,LEFT,start+38+14.4*i));
      link={url,top:start+23,bottom:Math.min(start+height,start+39+14.4*linkLines.length)};
      y=start+height;
    }
    beginPage();
    const paragraphs=String(data.text??'').replace(/\r\n?/g,'\n').split('\n');
    for(let i=0;i<paragraphs.length;i++){
      line(paragraphs[i],11.5,18.4);
      if(i>0 && i%45===0){onProgress?.(`Rendering text… (${i+1}/${paragraphs.length} paragraphs)`);await new Promise(requestAnimationFrame);}
      if(pageNo>300)throw new Error('More than 300 pages; the post text may be unexpectedly large.');
    }
    y+=9;
    drawActions();
    drawURL();
    finishPage(true);
    return pages;
  }
  async function download(data,onProgress){
    onProgress?.('Rendering Facebook-style pages (Arabic and Amharic supported)…');
    const pages=await renderPages(data,onProgress);
    onProgress?.(`Assembling ${pages.length}-page PDF…`);
    const blob=makePDF(pages);
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=safeName(data);
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    return {pages:pages.length,bytes:blob.size};
  }
  window.PostPdfExport={download};
})();
