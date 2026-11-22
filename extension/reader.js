// ==UserScript==
// @name         网页漫画增强阅读器
// @namespace    https://github.com/Roroca-1/manga-reader-plus
// @version      1.3.1
// @description  桌面级网页漫画增强阅读器：悬浮工具栏、单页/双页/条漫模式、左右翻页方向、画面适配与缩放、封面单显、跨页自动识别、页面总览与完整快捷键支持。
// @author       Roroca-1
// @license      MIT
// @homepageURL  https://github.com/Roroca-1/manga-reader-plus
// @supportURL   https://github.com/Roroca-1/manga-reader-plus/issues
// @updateURL    https://raw.githubusercontent.com/Roroca-1/manga-reader-plus/main/manga-reader-plus.user.js
// @downloadURL  https://raw.githubusercontent.com/Roroca-1/manga-reader-plus/main/manga-reader-plus.user.js
// @match        *://*.mangacopy.com/comic/*/chapter/*
// @match        *://*.copymanga.tv/comic/*/chapter/*
// @match        *://*.copymanga.site/comic/*/chapter/*
// @match        *://*.copymanga.org/comic/*/chapter/*
// @match        *://*.copymanga.net/comic/*/chapter/*
// @match        *://*.copymanga.com/comic/*/chapter/*
// @match        *://*.2024copy.com/comic/*/chapter/*
// @match        *://*.2025copy.com/comic/*/chapter/*
// @match        *://*.2026copy.com/comic/*/chapter/*
// @match        *://nhentai.net/g/*/*
// @match        *://*.nhentai.net/g/*/*
// @match        *://*.nhentai.to/g/*/*
// @match        *://*.nhentai.xxx/g/*/*
// @match        *://*.nhentai.website/g/*/*
// @match        *://*.18comic.vip/photo/*
// @match        *://*.18comic.org/photo/*
// @match        *://*.18comic.ink/photo/*
// @match        *://*.18comic.biz/photo/*
// @match        *://*.18comic.tw/photo/*
// @match        *://*.jmcomic.me/photo/*
// @match        *://*.jmcomic1.me/photo/*
// @match        *://*.jm-comic.cc/photo/*
// @match        *://*.jm-comic1.cc/photo/*
// @match        *://*.jm-comic2.cc/photo/*
// @match        *://*.jm-comic3.cc/photo/*
// @match        *://*.zerobyw33.com/*
// @match        *://*.zerobyw.com/*
// @include      /^https?:\/\/([^/]*\.)?(mangacopy|copymanga|\d{4}copy)\.[^/]+\/comic\/[^/]+\/chapter\//i
// @include      /^https?:\/\/([^/]*\.)?nhentai\.[^/]+\/g\/\d+\/\d+/i
// @include      /^https?:\/\/([^/]*\.)?(18comic|jmcomic\d*|jm-comic\d*|jm18c[^.]*)\.[^/]+\/photo\/\d+/i
// @include      /^https?:\/\/([^/]*\.)?zerobyw[a-z0-9-]*\.[^/]+\//i
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  if (window.__CM_STUDIO_MOUNTED__) return;
  window.__CM_STUDIO_MOUNTED__ = true;

  const SETTINGS_KEY = 'cm_studio_settings_v1';
  const PROGRESS_KEY = 'cm_studio_progress_v1';
  const MAX_PROGRESS_ENTRIES = 200;

  const DEFAULT_SETTINGS = {
    mode: 'single',            // 'single' | 'double' | 'strip'
    direction: 'rtl',          // 'rtl' | 'ltr'
    fit: 'screen',             // 'screen' | 'height' | 'width' | 'original' | 'custom'
    zoom: 100,                 // 50..250 (used when fit === 'custom')
    coverOffset: true,         // true = page 1 solo in double-page mode
    autoWideSpread: true,      // true = wide/landscape pages show solo in double-page mode
    clickZones: 'directional', // 'directional' | 'next' | 'off'
    wheelPaging: true,         // mouse wheel turns pages in single/double mode
    stripGap: 0,               // 0 | 8 | 16 px in vertical strip mode
    theme: 'obsidian',         // 'obsidian' | 'charcoal' | 'black' | 'paper'
    showHud: true,             // initial HUD visibility
    progressLine: true,        // hairline bottom progress bar when HUD is hidden
    preloadAhead: 2,           // gentle preloading to avoid CDN rate limits
  };

  // --- Utilities ---

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings(s) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch {}
  }

  function loadProgress(chapterKey) {
    try {
      const map = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}');
      return typeof map[chapterKey] === 'number' ? map[chapterKey] : 0;
    } catch {
      return 0;
    }
  }

  function saveProgress(chapterKey, pageIndex) {
    try {
      const map = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}');
      delete map[chapterKey];
      map[chapterKey] = pageIndex;
      const keys = Object.keys(map);
      if (keys.length > MAX_PROGRESS_ENTRIES) {
        for (let i = 0; i < keys.length - MAX_PROGRESS_ENTRIES; i++) {
          delete map[keys[i]];
        }
      }
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(map));
    } catch {}
  }

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  // --- Minimal Pure-JS MD5 (RFC 1321, used for 18comic image unscrambling) ---

  function md5(str) {
    const bytes = new TextEncoder().encode(str);
    const bitLen = bytes.length * 8;
    const padLen = ((56 - ((bytes.length + 1) % 64)) + 64) % 64;
    const buf = new Uint8Array(bytes.length + 1 + padLen + 8);
    buf.set(bytes);
    buf[bytes.length] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(buf.length - 8, bitLen >>> 0, true);
    dv.setUint32(buf.length - 4, Math.floor(bitLen / 0x100000000), true);

    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;

    const s = [
      7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
      5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
      4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
      6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];
    const K = new Uint32Array(64);
    for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;

    for (let offset = 0; offset < buf.length; offset += 64) {
      const M = new Uint32Array(16);
      for (let j = 0; j < 16; j++) M[j] = dv.getUint32(offset + j * 4, true);

      let A = a0, B = b0, C = c0, D = d0;
      for (let i = 0; i < 64; i++) {
        let F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; }
        else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
        else { F = C ^ (B | ~D); g = (7 * i) % 16; }
        F = (F + A + K[i] + M[g]) >>> 0;
        A = D;
        D = C;
        C = B;
        B = (B + ((F << s[i]) | (F >>> (32 - s[i])))) >>> 0;
      }
      a0 = (a0 + A) >>> 0;
      b0 = (b0 + B) >>> 0;
      c0 = (c0 + C) >>> 0;
      d0 = (d0 + D) >>> 0;
    }

    const toHex = (n) => {
      let out = '';
      for (let i = 0; i < 4; i++) out += ((n >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
      return out;
    };
    return toHex(a0) + toHex(b0) + toHex(c0) + toHex(d0);
  }

  // --- Site Adapters ---

  async function decryptCopyMangaKey(cct, contentKey) {
    if (!cct || !contentKey || contentKey.length < 32) return null;
    const enc = new TextEncoder();
    const keyBytes = enc.encode(cct);
    const ivBytes = enc.encode(contentKey.slice(0, 16));
    const hex = contentKey.slice(16);
    if (hex.length % 2 !== 0) return null;

    const cipherBytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      cipherBytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    }

    const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['decrypt']);
    const plainBuf = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: ivBytes }, cryptoKey, cipherBytes);
    const parsed = JSON.parse(new TextDecoder().decode(plainBuf));
    if (!Array.isArray(parsed)) return null;
    return parsed.map((item) => item?.url).filter(Boolean);
  }

  function findLinkByText(regex, selectors = 'a') {
    const anchors = document.querySelectorAll(selectors);
    for (const a of anchors) {
      const href = a.getAttribute('href');
      if (!href || href === '#' || href.startsWith('javascript:')) continue;
      if (regex.test(a.textContent.trim())) return a.href;
    }
    return null;
  }

  const SITE_ADAPTERS = [
    // 1. CopyManga & mirrors
    {
      id: 'copymanga',
      match: () => /(?:mangacopy|copymanga|202[4-9]copy)\./i.test(location.hostname) && /\/comic\/[^/]+\/chapter\//.test(location.pathname),
      extract: async () => {
        let urls = null;
        try {
          urls = await decryptCopyMangaKey(window.cct, window.contentKey);
        } catch (err) {
          console.warn('[MangaReader+] CopyManga decryption failed, falling back to DOM:', err);
        }
        if (!urls || urls.length === 0) {
          urls = [];
          document.querySelectorAll('.comicContent-list img').forEach((img) => {
            const src = img.getAttribute('data-src') || img.getAttribute('src');
            if (src && !src.includes('loading.jpg')) urls.push(src);
          });
        }
        const headerRaw = document.querySelector('h4.header')?.textContent?.trim() || document.title;
        const parts = headerRaw.split('/');
        const normalizeHref = (a) => {
          if (!a) return null;
          const href = a.getAttribute('href');
          if (!href || a.classList.contains('prev-null') || a.classList.contains('next-null')) return null;
          return a.href;
        };
        return {
          urls,
          meta: {
            comicTitle: parts.length > 1 ? parts[0].trim() : headerRaw,
            chapterTitle: parts.length > 1 ? parts.slice(1).join('/').trim() : '',
            chapterProgressText: document.querySelector('.comicContent-footer-txt')?.textContent?.trim() || '',
            prevHref: normalizeHref(document.querySelector('.comicContent-prev:not(.index):not(.list) a')),
            nextHref: normalizeHref(document.querySelector('.comicContent-next a')),
            tocHref: document.querySelector('.comicContent-prev.list a')?.href || location.pathname.split('/chapter/')[0],
            chapterKey: location.pathname,
          },
        };
      },
      cleanup: () => {
        window.onscroll = null;
        document.body.onmouseup = null;
      },
    },

    // 2. nhentai & mirrors
    {
      id: 'nhentai',
      match: () => /(?:^|\.)nhentai\./i.test(location.hostname) && /^\/g\/\d+\/\d+\/?$/.test(location.pathname),
      extract: async () => {
        let gallery = window._gallery;
        if (typeof gallery === 'string') {
          try { gallery = JSON.parse(gallery); } catch { gallery = null; }
        }
        if (!gallery || !gallery.images?.pages?.length) return null;

        const extMap = { j: 'jpg', p: 'png', g: 'gif', w: 'webp' };
        let cdnOrigin = 'https://i.nhentai.net';
        const curImgSrc = document.querySelector('#image-container img')?.src;
        if (curImgSrc) {
          try { cdnOrigin = new URL(curImgSrc).origin; } catch {}
        }

        const mediaId = gallery.media_id;
        const urls = gallery.images.pages.map((p, i) => `${cdnOrigin}/galleries/${mediaId}/${i + 1}.${extMap[p.t] || 'jpg'}`);
        const matchPath = location.pathname.match(/^\/g\/(\d+)\/(\d+)/);
        const galleryId = matchPath ? matchPath[1] : String(gallery.id || '');
        const initialPage = matchPath ? Math.max(0, parseInt(matchPath[2], 10) - 1) : 0;

        return {
          urls,
          initialPage,
          meta: {
            comicTitle: gallery.title?.japanese || gallery.title?.pretty || gallery.title?.english || document.title,
            chapterTitle: `#${galleryId}`,
            chapterProgressText: '',
            prevHref: null,
            nextHref: null,
            tocHref: `/g/${galleryId}/`,
            chapterKey: `/nhentai/g/${galleryId}`,
          },
        };
      },
    },

    // 3. 18comic / JMComic & mirrors (with built-in canvas image unscrambling)
    {
      id: 'jmcomic',
      match: () => /(?:18comic|jmcomic|jm-comic|jm18c)/i.test(location.hostname) && /\/photo\/\d+/.test(location.pathname),
      extract: async () => {
        const imgs = document.querySelectorAll('.scramble-page img, .panel-body img.lazy_img, .row.thumb-overlay-albums img');
        const urls = [];
        const seen = new Set();
        imgs.forEach((img) => {
          const src = img.getAttribute('data-original') || img.getAttribute('data-src') || img.getAttribute('src');
          if (!src || /blank\.jpg|loading\.gif|\/media\/logo/i.test(src) || seen.has(src)) return;
          seen.add(src);
          urls.push(src);
        });

        const aidMatch = location.pathname.match(/\/photo\/(\d+)/);
        const aid = Number(window.aid || (aidMatch ? aidMatch[1] : 0));
        const scrambleId = Number(window.scramble_id || 220980);

        const titleRaw = document.querySelector('h1, .panel-heading .pull-left')?.textContent?.trim() || document.title.replace(/\s*[-|].*$/, '');
        const tocHref = document.querySelector('a[href*="/album/"]')?.href || '/';
        const prevHref = findLinkByText(/上一[話话章]/);
        const nextHref = findLinkByText(/下一[話话章]/);

        return {
          urls,
          aid,
          scrambleId,
          meta: {
            comicTitle: titleRaw,
            chapterTitle: aid ? `JM${aid}` : '',
            chapterProgressText: '',
            prevHref,
            nextHref,
            tocHref,
            chapterKey: `/jmcomic/photo/${aid || location.pathname}`,
          },
        };
      },
      renderCanvas: (img, url, ctxData) => {
        const aid = ctxData.aid || 0;
        const scrambleId = ctxData.scrambleId || 220980;
        if (!aid || aid < scrambleId || /\.gif(\?|$)/i.test(url)) return null;

        const fileMatch = url.match(/\/([^/?#]+)\.[a-z0-9]+(?:[?#]|$)/i);
        const pageId = fileMatch ? fileMatch[1] : '';
        if (!pageId) return null;

        let num = 0;
        if (typeof window.get_num === 'function') {
          try { num = Number(window.get_num(aid, pageId)) || 0; } catch {}
        }
        if (!num) {
          if (aid < 268850) {
            num = 10;
          } else {
            const hash = md5(String(aid) + String(pageId));
            const code = hash.charCodeAt(hash.length - 1);
            num = aid > 421925 ? (code % 8 + 1) * 2 : (code % 10 + 1) * 2;
          }
        }
        if (num <= 1) return null;

        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (!w || !h) return null;

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        const rem = h % num;
        const sliceH = Math.floor(h / num);

        for (let m = 0; m < num; m++) {
          let copyH = sliceH;
          let dy = sliceH * m;
          const sy = h - sliceH * (m + 1) - rem;
          if (m === 0) copyH += rem;
          else dy += rem;
          ctx.drawImage(img, 0, sy, w, copyH, 0, dy, w, copyH);
        }
        return canvas;
      },
    },

    // 4. Zerobyw (Zero搬运网 & mirrors)
    {
      id: 'zerobyw',
      match: () => /zerobyw[a-z0-9-]*\./i.test(location.hostname) && (
        /\/pc\/view\//i.test(location.pathname) ||
        /[?&]zjid=\d+/i.test(location.search) ||
        /a=bofang/i.test(location.search) ||
        /\/manhua\//i.test(location.pathname) ||
        Boolean(document.querySelector('img.manga-image, .reader-image-frame img, .comic_wraCon img, .rd-manga img, #reader-container img'))
      ),
      extract: async () => {
        const selectors = [
          'img.manga-image',
          '.reader-image-frame img',
          '.comic_wraCon img',
          '.rd-manga img',
          '#reader-container img',
          '.comic-read img',
          '.uk-container .uk-grid img',
          'img[src*="/data/attachment/"]',
        ];
        const urls = [];
        const seen = new Set();
        const isNoise = (src) => /avatar|uc_server|static\/image\/common|smiley|logo|qrcode|ads?\//i.test(src);
        const normalizeUrl = (src) => (src.startsWith('//') ? `${location.protocol}${src}` : src);

        for (const sel of selectors) {
          const found = document.querySelectorAll(sel);
          if (found.length === 0) continue;
          found.forEach((img) => {
            const raw = img.getAttribute('data-original') || img.getAttribute('data-src') || img.getAttribute('src');
            if (!raw || isNoise(raw)) return;
            const src = normalizeUrl(raw);
            if (seen.has(src)) return;
            seen.add(src);
            urls.push(src);
          });
          if (urls.length > 0) break;
        }

        const detailLink = document.querySelector('a[href*="/pc/details/"]');
        const titleParts = document.title.split(/\s+-\s+/);
        const comicTitle = detailLink?.textContent?.trim() || titleParts[0]?.trim() || document.title;
        const chapterTitle = titleParts.length >= 3 ? `第 ${titleParts[1].trim()} 话` : '';
        const prevHref = findLinkByText(/^上一[話话章页]$/);
        const nextHref = findLinkByText(/^下一[話话章页]$/);
        const tocHref = detailLink?.href || findLinkByText(/目录|目錄|返回漫画|返回列表/) || '/pc/pc/';

        return {
          urls,
          meta: {
            comicTitle,
            chapterTitle,
            chapterProgressText: '',
            prevHref,
            nextHref,
            tocHref,
            chapterKey: location.pathname + location.search,
          },
        };
      },
    },
  ];

  function detectAdapter() {
    return SITE_ADAPTERS.find((a) => a.match()) || null;
  }

  // --- SVG Icons (crisp 16px stroke icons, decorative aria-hidden) ---

  const ICONS = {
    back: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>`,
    prev: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>`,
    next: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>`,
    chevronLeft: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>`,
    chevronRight: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>`,
    grid: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>`,
    settings: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>`,
    fullscreen: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>`,
    help: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    close: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    original: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
    retry: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`,
    minus: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    plus: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  };

  // --- Styles ---

  const STYLES = `
    :root {
      --cms-ease-out: cubic-bezier(0.23, 1, 0.32, 1);
      --cms-ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);

      /* Obsidian Dark Palette (default) */
      --cms-bg: #0a0a0c;
      --cms-chrome: rgba(20, 20, 23, 0.84);
      --cms-surface: #141417;
      --cms-surface-elevated: #1c1c21;
      --cms-surface-hover: rgba(255, 255, 255, 0.08);
      --cms-surface-active: rgba(255, 255, 255, 0.14);
      --cms-seg-bg: rgba(255, 255, 255, 0.045);
      --cms-border: rgba(255, 255, 255, 0.085);
      --cms-border-strong: rgba(255, 255, 255, 0.15);
      --cms-highlight: rgba(255, 255, 255, 0.06);
      --cms-ink: #f4f4f5;
      --cms-ink-muted: #9898a3;
      --cms-accent: #f4f4f5;
      --cms-accent-ink: #0a0a0c;
      --cms-ring: #f4f4f5;
      --cms-track: rgba(255, 255, 255, 0.16);
      --cms-shadow: 0 14px 40px rgba(0, 0, 0, 0.52);
      --cms-shadow-lg: 0 24px 64px rgba(0, 0, 0, 0.65);
      --cms-scrim-top: linear-gradient(to bottom, rgba(0, 0, 0, 0.55), transparent);
      --cms-backdrop: rgba(0, 0, 0, 0.68);
      --cms-spinner-track: rgba(255, 255, 255, 0.14);
      --cms-scrollbar: rgba(255, 255, 255, 0.18);

      --cms-radius: 12px;
      --cms-radius-sm: 8px;
      --cms-font: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", "PingFang TC", "Microsoft JhengHei", sans-serif;
      --cms-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    }

    #cms-root[data-theme="obsidian"] {
      --cms-bg: #0a0a0c;
      color-scheme: dark;
    }
    #cms-root[data-theme="charcoal"] {
      --cms-bg: #17171b;
      color-scheme: dark;
    }
    #cms-root[data-theme="black"] {
      --cms-bg: #000000;
      color-scheme: dark;
    }
    #cms-root[data-theme="paper"] {
      --cms-bg: #f3efe6;
      --cms-chrome: rgba(251, 249, 244, 0.88);
      --cms-surface: #fbf9f4;
      --cms-surface-elevated: #f0ebe0;
      --cms-surface-hover: rgba(28, 25, 23, 0.06);
      --cms-surface-active: rgba(28, 25, 23, 0.11);
      --cms-seg-bg: rgba(28, 25, 23, 0.055);
      --cms-border: rgba(28, 25, 23, 0.09);
      --cms-border-strong: rgba(28, 25, 23, 0.16);
      --cms-highlight: rgba(255, 255, 255, 0.7);
      --cms-ink: #1c1917;
      --cms-ink-muted: #78716c;
      --cms-accent: #1c1917;
      --cms-accent-ink: #fbf9f4;
      --cms-ring: #1c1917;
      --cms-track: rgba(28, 25, 23, 0.15);
      --cms-shadow: 0 12px 32px rgba(28, 25, 23, 0.12);
      --cms-shadow-lg: 0 24px 60px rgba(28, 25, 23, 0.18);
      --cms-scrim-top: linear-gradient(to bottom, rgba(243, 239, 230, 0.65), transparent);
      --cms-backdrop: rgba(28, 25, 23, 0.42);
      --cms-spinner-track: rgba(28, 25, 23, 0.14);
      --cms-scrollbar: rgba(28, 25, 23, 0.22);
      color-scheme: light;
    }

    html.cms-active,
    body.cms-active {
      margin: 0 !important;
      padding: 0 !important;
      overflow: hidden !important;
      height: 100% !important;
      width: 100% !important;
      background: var(--cms-bg) !important;
    }

    @media (pointer: fine) {
      html.cms-active {
        overscroll-behavior: none;
      }
    }

    body.cms-active > *:not(#cms-root) {
      display: none !important;
    }

    #cms-root {
      position: fixed;
      inset: 0;
      z-index: 2147483000;
      display: flex;
      flex-direction: column;
      background: var(--cms-bg);
      color: var(--cms-ink);
      font-family: var(--cms-font);
      font-size: 13px;
      line-height: 1.4;
      -webkit-font-smoothing: antialiased;
      user-select: none;
      -webkit-tap-highlight-color: transparent;
      transition: background-color 180ms ease;
    }

    #cms-root *,
    #cms-root *::before,
    #cms-root *::after {
      box-sizing: border-box;
    }

    :where(#cms-root) button,
    :where(#cms-root) a {
      font: inherit;
      color: inherit;
      text-decoration: none;
      touch-action: manipulation;
    }

    #cms-root button:focus-visible,
    #cms-root a:focus-visible,
    #cms-root input:focus-visible {
      outline: 2px solid var(--cms-ring);
      outline-offset: 2px;
    }

    /* --- Stage --- */

    .cms-stage {
      position: relative;
      flex: 1;
      width: 100%;
      height: 100%;
      overflow: auto;
      display: flex;
      flex-direction: column;
      scrollbar-width: thin;
      scrollbar-color: var(--cms-scrollbar) transparent;
    }

    .cms-stage.is-scrollable-top .cms-spread {
      margin: 0 auto;
    }

    .cms-stage.mode-strip {
      align-items: center;
      padding: 72px 0 116px;
    }

    /* --- Spreads (Single / Double) --- */

    .cms-spread {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 3px;
      margin: auto;
      position: relative;
    }

    .cms-spread.dir-rtl {
      flex-direction: row-reverse;
    }

    .cms-page-slot {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .cms-page-img {
      display: block;
      image-rendering: auto;
      background: rgba(128, 128, 128, 0.06);
      opacity: 1;
    }

    .cms-page-img.is-entering {
      opacity: 0;
      transition: opacity 160ms var(--cms-ease-out);
    }

    .cms-page-img.is-entering.is-loaded {
      opacity: 1;
    }

    /* Fit modes */
    .cms-stage.fit-screen .cms-page-img {
      max-height: 100dvh;
      max-width: 100vw;
      width: auto;
      height: auto;
      object-fit: contain;
    }

    .cms-stage.fit-screen.is-double-pair .cms-page-img {
      max-width: calc(50vw - 3px);
    }

    .cms-stage.fit-height .cms-page-img {
      height: 100dvh;
      width: auto;
      max-width: none;
    }

    .cms-stage.fit-width .cms-page-img {
      width: 100vw;
      height: auto;
      max-height: none;
    }

    .cms-stage.fit-width.is-double-pair .cms-page-img {
      width: calc(50vw - 3px);
    }

    .cms-stage.fit-original .cms-page-img {
      width: auto;
      height: auto;
      max-width: none;
      max-height: none;
    }

    .cms-stage.fit-custom .cms-page-img {
      width: calc(var(--cms-zoom, 100) * 0.65vw);
      height: auto;
      max-width: none;
      max-height: none;
    }

    .cms-stage.fit-custom.is-double-pair .cms-page-img {
      width: calc(var(--cms-zoom, 100) * 0.45vw);
    }

    /* Strip mode */
    .cms-strip-list {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 100%;
      gap: var(--cms-strip-gap, 0px);
    }

    .cms-strip-item {
      display: flex;
      justify-content: center;
      width: 100%;
      position: relative;
    }

    .cms-stage.mode-strip.fit-screen .cms-page-img {
      max-width: min(100vw, 960px);
      width: auto;
      height: auto;
    }

    .cms-stage.mode-strip.fit-width .cms-page-img {
      width: 100vw;
      max-width: none;
      height: auto;
    }

    .cms-stage.mode-strip.fit-height .cms-page-img {
      height: 100dvh;
      width: auto;
      max-width: 100vw;
    }

    .cms-stage.mode-strip.fit-original .cms-page-img {
      width: auto;
      height: auto;
      max-width: none;
    }

    .cms-stage.mode-strip.fit-custom .cms-page-img {
      width: calc(var(--cms-zoom, 100) * 0.8vw);
      max-width: none;
      height: auto;
    }

    /* Loading & Error state */
    .cms-page-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      width: min(320px, 80vw);
      height: min(460px, 65dvh);
      border-radius: 10px;
      background: var(--cms-seg-bg);
      border: 1px solid var(--cms-border);
      color: var(--cms-ink-muted);
      font-size: 12.5px;
      font-variant-numeric: tabular-nums;
    }

    .cms-spinner {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      border: 2px solid var(--cms-spinner-track);
      border-top-color: var(--cms-ink);
      animation: cms-spin 600ms linear infinite;
    }

    @keyframes cms-spin {
      to { transform: rotate(360deg); }
    }

    /* --- Click Zones & Subtle Edge Chevrons --- */

    .cms-click-layer {
      position: fixed;
      inset: 0;
      z-index: 10;
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      pointer-events: none;
    }

    .cms-click-layer.active {
      pointer-events: auto;
    }

    .cms-click-zone {
      position: relative;
      background: transparent;
      border: none;
      padding: 0;
      margin: 0;
      cursor: pointer;
    }

    .cms-click-zone:focus-visible {
      outline: none;
    }

    .cms-edge-hint {
      position: absolute;
      top: 50%;
      transform: translateY(-50%) scale(0.94);
      width: 38px;
      height: 54px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--cms-chrome);
      border: 1px solid var(--cms-border);
      color: var(--cms-ink);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      opacity: 0;
      pointer-events: none;
      transition: opacity 150ms var(--cms-ease-out), transform 150ms var(--cms-ease-out);
    }

    .cms-click-zone[data-zone="left"] .cms-edge-hint {
      left: 16px;
    }

    .cms-click-zone[data-zone="right"] .cms-edge-hint {
      right: 16px;
    }

    @media (hover: hover) and (pointer: fine) {
      .cms-click-zone:hover .cms-edge-hint {
        opacity: 0.85;
        transform: translateY(-50%) scale(1);
      }
      .cms-click-zone:active .cms-edge-hint {
        transform: translateY(-50%) scale(0.95);
      }
    }

    /* --- Floating Studio HUD Chrome --- */

    .cms-hud-top-wrap {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 30;
      padding: max(12px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) 18px max(16px, env(safe-area-inset-left));
      background: var(--cms-scrim-top);
      pointer-events: none;
      transition: transform 200ms var(--cms-ease-out), opacity 170ms var(--cms-ease-out);
      will-change: transform, opacity;
    }

    .cms-hud-top {
      max-width: 1120px;
      margin: 0 auto;
      height: 46px;
      padding: 0 8px 0 8px;
      border-radius: var(--cms-radius);
      background: var(--cms-chrome);
      border: 1px solid var(--cms-border);
      box-shadow: var(--cms-shadow), inset 0 1px 0 var(--cms-highlight);
      backdrop-filter: blur(18px) saturate(150%);
      -webkit-backdrop-filter: blur(18px) saturate(150%);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      pointer-events: auto;
    }

    .cms-hud-bottom-wrap {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 30;
      padding: 0 max(16px, env(safe-area-inset-right)) max(14px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
      pointer-events: none;
      transition: transform 200ms var(--cms-ease-out), opacity 170ms var(--cms-ease-out);
      will-change: transform, opacity;
    }

    .cms-hud-bottom {
      max-width: 780px;
      margin: 0 auto;
      padding: 10px 12px 9px;
      border-radius: 14px;
      background: var(--cms-chrome);
      border: 1px solid var(--cms-border);
      box-shadow: var(--cms-shadow), inset 0 1px 0 var(--cms-highlight);
      backdrop-filter: blur(18px) saturate(150%);
      -webkit-backdrop-filter: blur(18px) saturate(150%);
      display: flex;
      flex-direction: column;
      gap: 7px;
      pointer-events: auto;
    }

    #cms-root.hud-hidden .cms-hud-top-wrap {
      transform: translateY(-100%);
      opacity: 0;
      pointer-events: none;
    }

    #cms-root.hud-hidden .cms-hud-top-wrap .cms-hud-top,
    #cms-root.hud-hidden .cms-hud-bottom-wrap .cms-hud-bottom {
      pointer-events: none;
    }

    #cms-root.hud-hidden .cms-hud-bottom-wrap {
      transform: translateY(100%);
      opacity: 0;
      pointer-events: none;
    }

    .cms-title-group {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      flex: 1;
    }

    .cms-title-divider {
      width: 1px;
      height: 18px;
      background: var(--cms-border);
      flex-shrink: 0;
    }

    .cms-title-text {
      display: flex;
      align-items: baseline;
      gap: 8px;
      min-width: 0;
    }

    .cms-comic-name {
      font-size: 13px;
      font-weight: 600;
      letter-spacing: -0.01em;
      color: var(--cms-ink);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .cms-chapter-name {
      font-size: 12px;
      color: var(--cms-ink-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex-shrink: 1;
    }

    .cms-toolbar-actions {
      display: flex;
      align-items: center;
      gap: 2px;
      flex-shrink: 0;
    }

    /* --- Buttons --- */

    .cms-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      height: 30px;
      padding: 0 9px;
      border-radius: var(--cms-radius-sm);
      border: 1px solid transparent;
      background: transparent;
      color: var(--cms-ink);
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;
      transition: transform 140ms var(--cms-ease-out), background-color 140ms ease, border-color 140ms ease, color 140ms ease;
    }

    .cms-btn-icon {
      width: 30px;
      padding: 0;
      color: var(--cms-ink-muted);
    }

    @media (hover: hover) and (pointer: fine) {
      .cms-btn:hover:not(:disabled):not(.is-disabled) {
        background: var(--cms-surface-hover);
        color: var(--cms-ink);
      }
    }

    .cms-btn:active:not(:disabled):not(.is-disabled) {
      transform: scale(0.97);
    }

    .cms-btn[aria-expanded="true"],
    .cms-btn[aria-pressed="true"] {
      background: var(--cms-surface-active);
      border-color: var(--cms-border-strong);
      color: var(--cms-ink);
    }

    .cms-btn:disabled,
    .cms-btn.is-disabled {
      opacity: 0.34;
      pointer-events: none;
    }

    #cms-root .cms-btn-primary {
      background: var(--cms-accent);
      color: var(--cms-accent-ink);
      border-color: transparent;
    }

    @media (hover: hover) and (pointer: fine) {
      #cms-root .cms-btn-primary:hover:not(:disabled) {
        opacity: 0.92;
        background: var(--cms-accent);
        color: var(--cms-accent-ink);
      }
    }

    /* --- Scrubber & Dock Meta --- */

    .cms-scrubber-row {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
    }

    .cms-page-counter {
      font-family: var(--cms-mono);
      font-variant-numeric: tabular-nums;
      font-size: 11.5px;
      color: var(--cms-ink-muted);
      min-width: 62px;
      text-align: center;
      flex-shrink: 0;
    }

    .cms-page-counter strong {
      color: var(--cms-ink);
      font-weight: 600;
    }

    .cms-scrubber-wrap {
      position: relative;
      flex: 1;
      height: 26px;
      display: flex;
      align-items: center;
      cursor: pointer;
      border-radius: 6px;
    }

    .cms-scrubber-wrap:focus-within {
      outline: 2px solid var(--cms-ring);
      outline-offset: 2px;
    }

    .cms-scrubber-track {
      position: relative;
      width: 100%;
      height: 4px;
      border-radius: 99px;
      background: var(--cms-track);
      transition: transform 150ms var(--cms-ease-out);
      transform-origin: center;
    }

    @media (hover: hover) and (pointer: fine) {
      .cms-scrubber-wrap:hover .cms-scrubber-track {
        transform: scaleY(1.45);
      }
    }

    .cms-scrubber-fill {
      position: absolute;
      top: 0;
      bottom: 0;
      left: 0;
      background: var(--cms-ink);
      border-radius: 99px;
      width: 0%;
    }

    .cms-scrubber-wrap.dir-rtl .cms-scrubber-fill {
      left: auto;
      right: 0;
    }

    .cms-scrubber-thumb {
      position: absolute;
      top: 50%;
      left: 0%;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: var(--cms-ink);
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
      transform: translate(-50%, -50%) scale(0.75);
      opacity: 0;
      pointer-events: none;
      transition: opacity 140ms ease, transform 150ms var(--cms-ease-out);
    }

    .cms-scrubber-wrap.dir-rtl .cms-scrubber-thumb {
      left: auto;
      right: 0%;
      transform: translate(50%, -50%) scale(0.75);
    }

    .cms-scrubber-wrap:hover .cms-scrubber-thumb,
    .cms-scrubber-wrap:focus-within .cms-scrubber-thumb {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
    }

    .cms-scrubber-wrap.dir-rtl:hover .cms-scrubber-thumb,
    .cms-scrubber-wrap.dir-rtl:focus-within .cms-scrubber-thumb {
      transform: translate(50%, -50%) scale(1);
    }

    .cms-scrubber-input {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      opacity: 0;
      cursor: pointer;
      margin: 0;
    }

    .cms-scrubber-input:focus-visible {
      outline: none;
    }

    .cms-scrubber-wrap.dir-rtl .cms-scrubber-input {
      direction: rtl;
    }

    .cms-scrubber-tip {
      position: absolute;
      bottom: 30px;
      transform: translateX(-50%) scale(0.96);
      padding: 3px 8px;
      border-radius: 6px;
      background: var(--cms-surface);
      border: 1px solid var(--cms-border-strong);
      box-shadow: var(--cms-shadow);
      color: var(--cms-ink);
      font-family: var(--cms-mono);
      font-variant-numeric: tabular-nums;
      font-size: 11px;
      font-weight: 500;
      pointer-events: none;
      opacity: 0;
      transition: opacity 120ms ease, transform 140ms var(--cms-ease-out);
      white-space: nowrap;
    }

    .cms-scrubber-wrap:hover .cms-scrubber-tip {
      opacity: 1;
      transform: translateX(-50%) scale(1);
    }

    .cms-bottom-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding-top: 2px;
      border-top: 1px solid var(--cms-border);
    }

    .cms-quick-pills {
      display: flex;
      align-items: center;
      gap: 5px;
      flex-wrap: wrap;
    }

    .cms-pill {
      display: inline-flex;
      align-items: center;
      height: 23px;
      padding: 0 8px;
      border-radius: 6px;
      background: var(--cms-seg-bg);
      border: 1px solid var(--cms-border);
      color: var(--cms-ink-muted);
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      transition: transform 140ms var(--cms-ease-out), background-color 140ms ease, color 140ms ease, border-color 140ms ease;
    }

    @media (hover: hover) and (pointer: fine) {
      .cms-pill:hover {
        background: var(--cms-surface-hover);
        border-color: var(--cms-border-strong);
        color: var(--cms-ink);
      }
    }

    .cms-pill:active {
      transform: scale(0.97);
    }

    /* --- Subtle HUD-Hidden Indicators (Corner Badge + Hairline Progress) --- */

    .cms-mini-badge {
      position: fixed;
      bottom: max(12px, env(safe-area-inset-bottom));
      right: max(14px, env(safe-area-inset-right));
      z-index: 20;
      padding: 4px 9px;
      border-radius: 7px;
      background: var(--cms-chrome);
      border: 1px solid var(--cms-border);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      color: var(--cms-ink-muted);
      font-family: var(--cms-mono);
      font-variant-numeric: tabular-nums;
      font-size: 11px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 180ms ease;
    }

    #cms-root.hud-hidden .cms-mini-badge {
      opacity: 0.9;
    }

    .cms-hairline-progress {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 2px;
      z-index: 20;
      background: transparent;
      pointer-events: none;
      opacity: 0;
      transition: opacity 180ms ease;
    }

    #cms-root.hud-hidden.has-progress-line .cms-hairline-progress {
      opacity: 1;
    }

    .cms-hairline-fill {
      position: absolute;
      top: 0;
      bottom: 0;
      left: 0;
      width: 0%;
      background: var(--cms-ink);
      opacity: 0.45;
    }

    .cms-hairline-progress.dir-rtl .cms-hairline-fill {
      left: auto;
      right: 0;
    }

    /* --- Instant-Switching Custom Tooltip --- */

    .cms-tooltip {
      position: fixed;
      z-index: 80;
      padding: 4px 8px;
      border-radius: 6px;
      background: var(--cms-surface);
      border: 1px solid var(--cms-border-strong);
      box-shadow: var(--cms-shadow);
      color: var(--cms-ink);
      font-size: 11.5px;
      font-weight: 500;
      white-space: nowrap;
      pointer-events: none;
      opacity: 0;
      transform: translate(-50%, -2px) scale(0.97);
      transform-origin: top center;
      transition: opacity 120ms var(--cms-ease-out), transform 120ms var(--cms-ease-out);
    }

    .cms-tooltip.visible {
      opacity: 1;
      transform: translate(-50%, 0) scale(1);
    }

    .cms-tooltip.instant {
      transition-duration: 0ms;
    }

    /* --- Settings Popover (origin-aware top-right, asymmetric timing) --- */

    .cms-popover {
      position: fixed;
      top: 66px;
      right: max(16px, env(safe-area-inset-right));
      z-index: 50;
      width: 324px;
      max-height: calc(100dvh - 84px);
      overflow-y: auto;
      overscroll-behavior: contain;
      background: var(--cms-surface);
      border: 1px solid var(--cms-border-strong);
      border-radius: 14px;
      box-shadow: var(--cms-shadow-lg), inset 0 1px 0 var(--cms-highlight);
      padding: 14px;
      transform-origin: top right;
      opacity: 0;
      transform: scale(0.96) translateY(-4px);
      pointer-events: none;
      transition: transform 120ms var(--cms-ease-out), opacity 120ms var(--cms-ease-out);
    }

    .cms-popover.open {
      opacity: 1;
      transform: scale(1) translateY(0);
      pointer-events: auto;
      transition: transform 180ms var(--cms-ease-out), opacity 180ms var(--cms-ease-out);
    }

    .cms-pop-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--cms-border);
    }

    .cms-pop-title {
      font-size: 13px;
      font-weight: 600;
      letter-spacing: -0.01em;
      color: var(--cms-ink);
      text-wrap: balance;
    }

    .cms-pop-section {
      padding-bottom: 12px;
      margin-bottom: 12px;
      border-bottom: 1px solid var(--cms-border);
      display: flex;
      flex-direction: column;
      gap: 11px;
    }

    .cms-pop-section:last-child {
      padding-bottom: 0;
      margin-bottom: 0;
      border-bottom: none;
    }

    .cms-field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .cms-field-label {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.01em;
      color: var(--cms-ink-muted);
    }

    .cms-seg {
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: 1fr;
      gap: 3px;
      padding: 3px;
      border-radius: 9px;
      background: var(--cms-seg-bg);
      border: 1px solid var(--cms-border);
    }

    .cms-seg-btn {
      height: 27px;
      border: none;
      border-radius: 6px;
      background: transparent;
      color: var(--cms-ink-muted);
      font-size: 11.5px;
      font-weight: 500;
      cursor: pointer;
      transition: transform 140ms var(--cms-ease-out), background-color 140ms ease, color 140ms ease;
    }

    @media (hover: hover) and (pointer: fine) {
      .cms-seg-btn:not([aria-pressed="true"]):hover {
        color: var(--cms-ink);
      }
    }

    .cms-seg-btn:active {
      transform: scale(0.97);
    }

    #cms-root .cms-seg-btn[aria-pressed="true"] {
      background: var(--cms-accent);
      color: var(--cms-accent-ink);
      font-weight: 600;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
    }

    .cms-zoom-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .cms-zoom-step {
      width: 26px;
      height: 26px;
      padding: 0;
      border-radius: 6px;
      border: 1px solid var(--cms-border);
      background: var(--cms-seg-bg);
      color: var(--cms-ink);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      flex-shrink: 0;
      transition: transform 140ms var(--cms-ease-out), background-color 140ms ease;
    }

    @media (hover: hover) and (pointer: fine) {
      .cms-zoom-step:hover {
        background: var(--cms-surface-hover);
      }
    }

    .cms-zoom-step:active {
      transform: scale(0.95);
    }

    .cms-zoom-reset {
      border: none;
      background: transparent;
      padding: 1px 4px;
      border-radius: 4px;
      font-family: var(--cms-mono);
      font-variant-numeric: tabular-nums;
      font-size: 11px;
      color: var(--cms-ink);
      cursor: pointer;
    }

    @media (hover: hover) and (pointer: fine) {
      .cms-zoom-reset:hover {
        background: var(--cms-surface-hover);
      }
    }

    .cms-toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 3px 0;
      cursor: pointer;
      gap: 10px;
    }

    .cms-toggle-row span {
      font-size: 12.5px;
      color: var(--cms-ink);
    }

    .cms-switch {
      appearance: none;
      -webkit-appearance: none;
      width: 34px;
      height: 19px;
      border-radius: 99px;
      background: var(--cms-track);
      position: relative;
      cursor: pointer;
      transition: background-color 160ms ease;
      flex-shrink: 0;
    }

    .cms-switch::after {
      content: "";
      position: absolute;
      top: 2px;
      left: 2px;
      width: 15px;
      height: 15px;
      border-radius: 50%;
      background: #ffffff;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
      transition: transform 160ms var(--cms-ease-out);
    }

    .cms-switch:checked {
      background: var(--cms-accent);
    }

    .cms-switch:checked::after {
      background: var(--cms-accent-ink);
      transform: translateX(15px);
    }

    .cms-range {
      flex: 1;
      accent-color: var(--cms-accent);
      cursor: pointer;
    }

    .cms-swatches {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 6px;
    }

    .cms-swatch {
      height: 29px;
      border-radius: 7px;
      border: 1px solid var(--cms-border-strong);
      cursor: pointer;
      font-size: 11px;
      font-weight: 500;
      transition: transform 140ms var(--cms-ease-out), border-color 140ms ease;
    }

    .cms-swatch:active {
      transform: scale(0.97);
    }

    .cms-swatch[aria-pressed="true"] {
      outline: 2px solid var(--cms-ink);
      outline-offset: 2px;
    }

    /* --- Modals (Centered, origin-center) --- */

    .cms-modal-backdrop {
      position: fixed;
      inset: 0;
      z-index: 60;
      background: var(--cms-backdrop);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      opacity: 0;
      pointer-events: none;
      transition: opacity 150ms ease;
    }

    .cms-modal-backdrop.open {
      opacity: 1;
      pointer-events: auto;
    }

    .cms-modal {
      width: min(880px, 100%);
      max-height: calc(100dvh - 48px);
      display: flex;
      flex-direction: column;
      background: var(--cms-surface);
      border: 1px solid var(--cms-border-strong);
      border-radius: 16px;
      box-shadow: var(--cms-shadow-lg), inset 0 1px 0 var(--cms-highlight);
      overflow: hidden;
      transform-origin: center;
      transform: scale(0.96);
      transition: transform 180ms var(--cms-ease-out);
    }

    .cms-modal-backdrop.open .cms-modal {
      transform: scale(1);
    }

    .cms-modal-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 13px 16px;
      border-bottom: 1px solid var(--cms-border);
    }

    .cms-modal-head-actions {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .cms-modal-body {
      padding: 16px;
      overflow-y: auto;
      overscroll-behavior: contain;
    }

    .cms-thumb-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(116px, 1fr));
      gap: 12px;
    }

    .cms-thumb-card {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: 6px;
      border-radius: 9px;
      border: 1px solid var(--cms-border);
      background: var(--cms-seg-bg);
      cursor: pointer;
      content-visibility: auto;
      contain-intrinsic-size: 116px 190px;
      transition: transform 150ms var(--cms-ease-out), border-color 140ms ease, background-color 140ms ease;
    }

    @media (hover: hover) and (pointer: fine) {
      .cms-thumb-card:hover {
        border-color: var(--cms-border-strong);
        background: var(--cms-surface-hover);
      }
    }

    .cms-thumb-card:active {
      transform: scale(0.97);
    }

    .cms-thumb-card.is-current {
      border-color: var(--cms-ink);
      background: var(--cms-surface-active);
    }

    .cms-thumb-card img {
      width: 100%;
      aspect-ratio: 2 / 3;
      object-fit: cover;
      border-radius: 5px;
      background: var(--cms-seg-bg);
    }

    .cms-thumb-num {
      font-family: var(--cms-mono);
      font-variant-numeric: tabular-nums;
      font-size: 11px;
      color: var(--cms-ink-muted);
    }

    .cms-thumb-card.is-current .cms-thumb-num {
      color: var(--cms-ink);
      font-weight: 600;
    }

    /* --- Shortcuts Grid --- */

    .cms-kbd-groups {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
      gap: 18px 24px;
    }

    .cms-kbd-group-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--cms-ink-muted);
      margin-bottom: 8px;
    }

    .cms-kbd-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 0;
      border-bottom: 1px solid var(--cms-border);
      font-size: 12.5px;
      gap: 10px;
    }

    .cms-kbd-row:last-child {
      border-bottom: none;
    }

    .cms-kbd-keys {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }

    .cms-kbd {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 22px;
      height: 21px;
      padding: 0 6px;
      border-radius: 5px;
      background: var(--cms-seg-bg);
      border: 1px solid var(--cms-border-strong);
      font-family: var(--cms-mono);
      font-size: 11px;
      color: var(--cms-ink);
    }

    /* --- End-of-Chapter Card (Strip Mode) --- */

    .cms-chapter-end {
      margin: 40px auto 20px;
      padding: 22px 24px;
      width: min(440px, calc(100% - 32px));
      border-radius: 14px;
      background: var(--cms-surface);
      border: 1px solid var(--cms-border-strong);
      box-shadow: var(--cms-shadow);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 14px;
      text-align: center;
    }

    .cms-chapter-end-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: center;
    }

    /* --- Toast (aria-live) --- */

    .cms-toast {
      position: fixed;
      top: 72px;
      left: 50%;
      transform: translateX(-50%) translateY(-6px) scale(0.97);
      z-index: 75;
      padding: 6px 13px;
      border-radius: 99px;
      background: var(--cms-surface);
      border: 1px solid var(--cms-border-strong);
      color: var(--cms-ink);
      font-size: 12px;
      font-weight: 500;
      box-shadow: var(--cms-shadow);
      opacity: 0;
      pointer-events: none;
      transition: opacity 150ms var(--cms-ease-out), transform 150ms var(--cms-ease-out);
    }

    .cms-toast.visible {
      opacity: 1;
      transform: translateX(-50%) translateY(0) scale(1);
    }

    @media (max-width: 600px) {
      .cms-chapter-name { display: none; }
      .cms-btn span.cms-hide-sm { display: none; }
    }

    @media (prefers-reduced-motion: reduce) {
      .cms-hud-top-wrap,
      .cms-hud-bottom-wrap,
      .cms-popover,
      .cms-modal,
      .cms-toast,
      .cms-tooltip,
      .cms-edge-hint,
      .cms-btn,
      .cms-seg-btn,
      .cms-pill,
      .cms-thumb-card,
      .cms-scrubber-track,
      .cms-scrubber-thumb {
        transition: opacity 140ms ease !important;
        transform: none !important;
      }
      #cms-root.hud-hidden .cms-hud-top-wrap,
      #cms-root.hud-hidden .cms-hud-bottom-wrap {
        transform: none !important;
      }
      .cms-spinner {
        animation-duration: 1.5s;
      }
    }
  `;

  // --- Main Reader App ---

  async function init() {
    const adapter = detectAdapter();
    if (!adapter) return;

    const extracted = await adapter.extract();
    if (!extracted || !extracted.urls || extracted.urls.length === 0) {
      console.warn(`[MangaReader+] (${adapter.id}) No chapter images found on this page.`);
      return;
    }

    const { urls, meta } = extracted;
    const settings = loadSettings();
    const total = urls.length;
    const savedIndex = loadProgress(meta.chapterKey);
    let currentIndex = clamp(
      typeof extracted.initialPage === 'number' ? extracted.initialPage : savedIndex,
      0,
      total - 1
    );

    const pageDimensions = new Map();
    const preloadCache = new Map();

    if (typeof adapter.cleanup === 'function') adapter.cleanup();

    const styleEl = document.createElement('style');
    styleEl.id = 'cms-styles';
    styleEl.textContent = STYLES;
    document.head.appendChild(styleEl);

    document.documentElement.classList.add('cms-active');
    document.body.classList.add('cms-active');

    const root = document.createElement('div');
    root.id = 'cms-root';
    root.dataset.theme = settings.theme;
    if (!settings.showHud) root.classList.add('hud-hidden');
    if (settings.progressLine) root.classList.add('has-progress-line');

    root.innerHTML = `
      <main class="cms-stage" id="cms-stage" tabindex="-1"></main>

      <div class="cms-click-layer" id="cms-click-layer" aria-hidden="true">
        <button type="button" class="cms-click-zone" data-zone="left" tabindex="-1">
          <span class="cms-edge-hint">${ICONS.chevronLeft}</span>
        </button>
        <button type="button" class="cms-click-zone" data-zone="center" tabindex="-1"></button>
        <button type="button" class="cms-click-zone" data-zone="right" tabindex="-1">
          <span class="cms-edge-hint">${ICONS.chevronRight}</span>
        </button>
      </div>

      <div class="cms-hud-top-wrap">
        <header class="cms-hud-top" role="banner">
          <div class="cms-title-group">
            <a class="cms-btn cms-btn-icon" href="${meta.tocHref}" aria-label="返回漫画详情" data-tip="返回漫画详情">
              ${ICONS.back}
            </a>
            <span class="cms-title-divider" aria-hidden="true"></span>
            <div class="cms-title-text">
              <span class="cms-comic-name"></span>
              <span class="cms-chapter-name"></span>
            </div>
          </div>
          <div class="cms-toolbar-actions">
            <button type="button" class="cms-btn cms-btn-icon" id="cms-btn-grid" aria-label="页面总览 (G)" data-tip="页面总览 (G)">
              ${ICONS.grid}
            </button>
            <button type="button" class="cms-btn cms-btn-icon" id="cms-btn-settings" aria-label="阅读设置 (S)" aria-expanded="false" aria-controls="cms-popover" data-tip="阅读设置 (S)">
              ${ICONS.settings}
            </button>
            <button type="button" class="cms-btn cms-btn-icon" id="cms-btn-fullscreen" aria-label="全屏模式 (Shift+F)" data-tip="全屏模式 (⇧F)">
              ${ICONS.fullscreen}
            </button>
            <button type="button" class="cms-btn cms-btn-icon" id="cms-btn-help" aria-label="快捷键说明 (?)" data-tip="快捷键说明 (?)">
              ${ICONS.help}
            </button>
            <button type="button" class="cms-btn cms-btn-icon" id="cms-btn-original" aria-label="切换原版页面 (Alt+O)" data-tip="切换原版页面 (Alt+O)">
              ${ICONS.original}
            </button>
          </div>
        </header>
      </div>

      <div class="cms-hud-bottom-wrap">
        <footer class="cms-hud-bottom" role="contentinfo">
          <div class="cms-scrubber-row">
            <a class="cms-btn ${meta.prevHref ? '' : 'is-disabled'}" id="cms-prev-ch" href="${meta.prevHref || '#'}" aria-label="上一话" data-tip="上一话 ([)">
              ${ICONS.prev}<span class="cms-hide-sm">上一话</span>
            </a>

            <div class="cms-scrubber-wrap" id="cms-scrubber-wrap">
              <div class="cms-scrubber-track">
                <div class="cms-scrubber-fill" id="cms-scrubber-fill"></div>
              </div>
              <div class="cms-scrubber-thumb" id="cms-scrubber-thumb" aria-hidden="true"></div>
              <input type="range" class="cms-scrubber-input" id="cms-scrubber" min="1" max="${total}" value="${currentIndex + 1}" aria-label="页码进度条" />
              <div class="cms-scrubber-tip" id="cms-scrubber-tip">1 / ${total}</div>
            </div>

            <div class="cms-page-counter" id="cms-counter"><strong>1</strong> / ${total}</div>

            <a class="cms-btn ${meta.nextHref ? '' : 'is-disabled'}" id="cms-next-ch" href="${meta.nextHref || '#'}" aria-label="下一话" data-tip="下一话 (])">
              <span class="cms-hide-sm">下一话</span>${ICONS.next}
            </a>
          </div>

          <div class="cms-bottom-meta">
            <div class="cms-quick-pills">
              <button type="button" class="cms-pill" id="cms-pill-mode" data-tip="切换阅读模式 (1/2/3)"></button>
              <button type="button" class="cms-pill" id="cms-pill-fit" data-tip="切换画面适配 (F)"></button>
              <button type="button" class="cms-pill" id="cms-pill-dir" data-tip="切换翻页方向 (R)"></button>
            </div>
            <span id="cms-chapter-progress" style="font-size: 11px; color: var(--cms-ink-muted); font-variant-numeric: tabular-nums;"></span>
          </div>
        </footer>
      </div>

      <div class="cms-mini-badge" id="cms-mini-badge" aria-hidden="true">1 / ${total}</div>
      <div class="cms-hairline-progress" id="cms-hairline" aria-hidden="true">
        <div class="cms-hairline-fill" id="cms-hairline-fill"></div>
      </div>

      <div class="cms-tooltip" id="cms-tooltip" role="tooltip" aria-hidden="true"></div>

      <aside class="cms-popover" id="cms-popover" role="dialog" aria-label="阅读设置">
        <div class="cms-pop-header">
          <span class="cms-pop-title">阅读设置</span>
          <button type="button" class="cms-btn cms-btn-icon" id="cms-pop-close" aria-label="关闭设置">${ICONS.close}</button>
        </div>

        <div class="cms-pop-section">
          <div class="cms-field">
            <span class="cms-field-label">阅读模式</span>
            <div class="cms-seg" data-setting="mode">
              <button type="button" class="cms-seg-btn" data-value="single">单页</button>
              <button type="button" class="cms-seg-btn" data-value="double">双页</button>
              <button type="button" class="cms-seg-btn" data-value="strip">条漫</button>
            </div>
          </div>

          <div class="cms-field">
            <span class="cms-field-label">翻页方向</span>
            <div class="cms-seg" data-setting="direction">
              <button type="button" class="cms-seg-btn" data-value="rtl">从右到左</button>
              <button type="button" class="cms-seg-btn" data-value="ltr">从左到右</button>
            </div>
          </div>
        </div>

        <div class="cms-pop-section">
          <div class="cms-field">
            <span class="cms-field-label">画面适配</span>
            <div class="cms-seg" data-setting="fit">
              <button type="button" class="cms-seg-btn" data-value="screen">适应屏幕</button>
              <button type="button" class="cms-seg-btn" data-value="height">适应高度</button>
              <button type="button" class="cms-seg-btn" data-value="width">适应宽度</button>
              <button type="button" class="cms-seg-btn" data-value="original">原图</button>
            </div>
          </div>

          <div class="cms-field">
            <label class="cms-field-label" for="cms-zoom-range">
              <span>自定义缩放</span>
              <button type="button" class="cms-zoom-reset" id="cms-zoom-val" data-tip="重置为适应屏幕">100%</button>
            </label>
            <div class="cms-zoom-row">
              <button type="button" class="cms-zoom-step" id="cms-zoom-dec" aria-label="缩小">${ICONS.minus}</button>
              <input type="range" id="cms-zoom-range" class="cms-range" min="50" max="250" step="5" value="${settings.zoom}" />
              <button type="button" class="cms-zoom-step" id="cms-zoom-inc" aria-label="放大">${ICONS.plus}</button>
            </div>
          </div>

          <div class="cms-field" id="cms-strip-gap-field">
            <span class="cms-field-label">条漫页间距</span>
            <div class="cms-seg" data-setting="stripGap">
              <button type="button" class="cms-seg-btn" data-value="0">无间距</button>
              <button type="button" class="cms-seg-btn" data-value="8">8 px</button>
              <button type="button" class="cms-seg-btn" data-value="16">16 px</button>
            </div>
          </div>
        </div>

        <div class="cms-pop-section">
          <div class="cms-field">
            <span class="cms-field-label">点击翻页区域</span>
            <div class="cms-seg" data-setting="clickZones">
              <button type="button" class="cms-seg-btn" data-value="directional">左右翻页</button>
              <button type="button" class="cms-seg-btn" data-value="next">点击下一页</button>
              <button type="button" class="cms-seg-btn" data-value="off">关闭</button>
            </div>
          </div>

          <div class="cms-field">
            <label class="cms-toggle-row">
              <span>双页封面单显（偏移）</span>
              <input type="checkbox" class="cms-switch" id="cms-opt-cover" />
            </label>
            <label class="cms-toggle-row">
              <span>自动识别跨页宽图</span>
              <input type="checkbox" class="cms-switch" id="cms-opt-wide" />
            </label>
            <label class="cms-toggle-row">
              <span>鼠标滚轮翻页</span>
              <input type="checkbox" class="cms-switch" id="cms-opt-wheel" />
            </label>
            <label class="cms-toggle-row">
              <span>隐藏工具栏时显示进度条</span>
              <input type="checkbox" class="cms-switch" id="cms-opt-progress" />
            </label>
          </div>
        </div>

        <div class="cms-pop-section">
          <div class="cms-field">
            <span class="cms-field-label">画布背景</span>
            <div class="cms-swatches" data-setting="theme">
              <button type="button" class="cms-swatch" data-value="obsidian" style="background:#0a0a0c;color:#f4f4f5;">曜石黑</button>
              <button type="button" class="cms-swatch" data-value="charcoal" style="background:#17171b;color:#f4f4f5;">深炭灰</button>
              <button type="button" class="cms-swatch" data-value="black" style="background:#000000;color:#f4f4f5;">纯黑</button>
              <button type="button" class="cms-swatch" data-value="paper" style="background:#f3efe6;color:#1c1917;">暖纸白</button>
            </div>
          </div>
        </div>
      </aside>

      <div class="cms-modal-backdrop" id="cms-grid-modal" role="dialog" aria-modal="true" aria-label="页面总览">
        <div class="cms-modal">
          <div class="cms-modal-head">
            <span class="cms-pop-title">全部页面（${total} 页）</span>
            <div class="cms-modal-head-actions">
              <button type="button" class="cms-btn" id="cms-grid-first">首页</button>
              <button type="button" class="cms-btn" id="cms-grid-last">末页</button>
              <button type="button" class="cms-btn cms-btn-icon" data-close-modal aria-label="关闭页面总览">${ICONS.close}</button>
            </div>
          </div>
          <div class="cms-modal-body">
            <div class="cms-thumb-grid" id="cms-thumb-grid"></div>
          </div>
        </div>
      </div>

      <div class="cms-modal-backdrop" id="cms-help-modal" role="dialog" aria-modal="true" aria-label="快捷键说明">
        <div class="cms-modal" style="max-width: 600px;">
          <div class="cms-modal-head">
            <span class="cms-pop-title">快捷键说明</span>
            <button type="button" class="cms-btn cms-btn-icon" data-close-modal aria-label="关闭快捷键说明">${ICONS.close}</button>
          </div>
          <div class="cms-modal-body">
            <div class="cms-kbd-groups">
              <div>
                <div class="cms-kbd-group-title">翻页与章节</div>
                <div class="cms-kbd-row"><span>上一页 / 下一页</span><span class="cms-kbd-keys"><kbd class="cms-kbd">←</kbd><kbd class="cms-kbd">→</kbd></span></div>
                <div class="cms-kbd-row"><span>WASD 翻页</span><span class="cms-kbd-keys"><kbd class="cms-kbd">A</kbd><kbd class="cms-kbd">D</kbd></span></div>
                <div class="cms-kbd-row"><span>空格翻页 / 反向</span><span class="cms-kbd-keys"><kbd class="cms-kbd">Space</kbd><kbd class="cms-kbd">⇧</kbd></span></div>
                <div class="cms-kbd-row"><span>上一话 / 下一话</span><span class="cms-kbd-keys"><kbd class="cms-kbd">[</kbd><kbd class="cms-kbd">]</kbd></span></div>
              </div>
              <div>
                <div class="cms-kbd-group-title">排版与缩放</div>
                <div class="cms-kbd-row"><span>单页 / 双页 / 条漫</span><span class="cms-kbd-keys"><kbd class="cms-kbd">1</kbd><kbd class="cms-kbd">2</kbd><kbd class="cms-kbd">3</kbd></span></div>
                <div class="cms-kbd-row"><span>切换画面适配</span><span class="cms-kbd-keys"><kbd class="cms-kbd">F</kbd></span></div>
                <div class="cms-kbd-row"><span>放大 / 缩小 / 重置</span><span class="cms-kbd-keys"><kbd class="cms-kbd">+</kbd><kbd class="cms-kbd">-</kbd><kbd class="cms-kbd">0</kbd></span></div>
                <div class="cms-kbd-row"><span>切换翻页方向</span><span class="cms-kbd-keys"><kbd class="cms-kbd">R</kbd></span></div>
                <div class="cms-kbd-row"><span>切换封面单显</span><span class="cms-kbd-keys"><kbd class="cms-kbd">C</kbd></span></div>
              </div>
              <div>
                <div class="cms-kbd-group-title">界面控制</div>
                <div class="cms-kbd-row"><span>显示 / 隐藏工具栏</span><span class="cms-kbd-keys"><kbd class="cms-kbd">H</kbd></span></div>
                <div class="cms-kbd-row"><span>打开阅读设置</span><span class="cms-kbd-keys"><kbd class="cms-kbd">S</kbd></span></div>
                <div class="cms-kbd-row"><span>打开页面总览</span><span class="cms-kbd-keys"><kbd class="cms-kbd">G</kbd></span></div>
                <div class="cms-kbd-row"><span>全屏模式</span><span class="cms-kbd-keys"><kbd class="cms-kbd">⇧</kbd><kbd class="cms-kbd">F</kbd></span></div>
                <div class="cms-kbd-row"><span>切换原版页面</span><span class="cms-kbd-keys"><kbd class="cms-kbd">Alt</kbd><kbd class="cms-kbd">O</kbd></span></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="cms-toast" id="cms-toast" role="status" aria-live="polite"></div>
    `;

    document.body.appendChild(root);

    // Populate titles safely via textContent
    root.querySelector('.cms-comic-name').textContent = meta.comicTitle;
    root.querySelector('.cms-chapter-name').textContent = meta.chapterTitle || '当前章节';
    root.querySelector('#cms-chapter-progress').textContent = meta.chapterProgressText;

    // Refs
    const stage = root.querySelector('#cms-stage');
    const clickLayer = root.querySelector('#cms-click-layer');
    const scrubberWrap = root.querySelector('#cms-scrubber-wrap');
    const scrubber = root.querySelector('#cms-scrubber');
    const scrubberFill = root.querySelector('#cms-scrubber-fill');
    const scrubberThumb = root.querySelector('#cms-scrubber-thumb');
    const scrubberTip = root.querySelector('#cms-scrubber-tip');
    const counterEl = root.querySelector('#cms-counter');
    const miniBadge = root.querySelector('#cms-mini-badge');
    const hairlineEl = root.querySelector('#cms-hairline');
    const hairlineFill = root.querySelector('#cms-hairline-fill');
    const tooltipEl = root.querySelector('#cms-tooltip');
    const popover = root.querySelector('#cms-popover');
    const btnSettings = root.querySelector('#cms-btn-settings');
    const gridModal = root.querySelector('#cms-grid-modal');
    const helpModal = root.querySelector('#cms-help-modal');
    const thumbGrid = root.querySelector('#cms-thumb-grid');
    const toastEl = root.querySelector('#cms-toast');
    const zoomRange = root.querySelector('#cms-zoom-range');
    const zoomVal = root.querySelector('#cms-zoom-val');
    const optCover = root.querySelector('#cms-opt-cover');
    const optWide = root.querySelector('#cms-opt-wide');
    const optWheel = root.querySelector('#cms-opt-wheel');
    const optProgress = root.querySelector('#cms-opt-progress');
    const pillMode = root.querySelector('#cms-pill-mode');
    const pillFit = root.querySelector('#cms-pill-fit');
    const pillDir = root.querySelector('#cms-pill-dir');

    // --- Instant-Switching Tooltip Controller (Emil Kowalski pattern) ---

    let tipOpen = false;
    let tipShowTimer = null;
    let tipCoolTimer = null;

    function showTooltipFor(el) {
      const text = el.getAttribute('data-tip');
      if (!text) return;
      clearTimeout(tipShowTimer);
      clearTimeout(tipCoolTimer);

      const positionAndReveal = (instant) => {
        const rect = el.getBoundingClientRect();
        tooltipEl.textContent = text;
        tooltipEl.classList.toggle('instant', instant);
        const placeAbove = rect.bottom + 42 > window.innerHeight;
        tooltipEl.style.left = `${clamp(rect.left + rect.width / 2, 56, window.innerWidth - 56)}px`;
        tooltipEl.style.top = placeAbove ? `${rect.top - 30}px` : `${rect.bottom + 8}px`;
        tooltipEl.classList.add('visible');
        tipOpen = true;
      };

      if (tipOpen) {
        positionAndReveal(true);
      } else {
        tipShowTimer = setTimeout(() => positionAndReveal(false), 320);
      }
    }

    function hideTooltip() {
      clearTimeout(tipShowTimer);
      tooltipEl.classList.remove('visible');
      clearTimeout(tipCoolTimer);
      tipCoolTimer = setTimeout(() => {
        tipOpen = false;
      }, 280);
    }

    root.addEventListener('pointerover', (e) => {
      if (e.pointerType !== 'mouse') return;
      const target = e.target.closest('[data-tip]');
      if (target) showTooltipFor(target);
    });

    root.addEventListener('pointerout', (e) => {
      if (e.pointerType !== 'mouse') return;
      const target = e.target.closest('[data-tip]');
      if (target && !target.contains(e.relatedTarget)) hideTooltip();
    });

    root.addEventListener('pointerdown', hideTooltip);

    // --- Toast ---

    let toastTimer = null;
    function showToast(msg) {
      toastEl.textContent = msg;
      toastEl.classList.add('visible');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl.classList.remove('visible'), 1500);
    }

    // --- Spread Computation ---

    function isWidePage(idx) {
      if (!settings.autoWideSpread) return false;
      const d = pageDimensions.get(idx);
      return d ? d.isWide : false;
    }

    function getSpreadIndices(anchorIndex) {
      const idx = clamp(anchorIndex, 0, total - 1);
      if (settings.mode !== 'double') return [idx];
      if (settings.coverOffset && idx === 0) return [0];
      if (isWidePage(idx)) return [idx];

      let pairStart = idx;
      if (settings.coverOffset) {
        if (idx % 2 === 0) pairStart = idx - 1;
      } else {
        if (idx % 2 === 1) pairStart = idx - 1;
      }

      if (pairStart < 0) pairStart = 0;
      if (pairStart !== idx && isWidePage(pairStart)) return [idx];

      const second = pairStart + 1;
      if (second < total && !isWidePage(second)) {
        return [pairStart, second];
      }
      return [pairStart];
    }

    // --- Gentle Preloader ---

    function preloadPage(idx) {
      if (idx < 0 || idx >= total || preloadCache.has(idx)) return;
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        const isWide = img.naturalWidth > img.naturalHeight * 1.12;
        const prev = pageDimensions.get(idx);
        pageDimensions.set(idx, { w: img.naturalWidth, h: img.naturalHeight, isWide });
        if (!prev && isWide && settings.mode === 'double') {
          const spread = getSpreadIndices(currentIndex);
          if (spread.includes(idx)) renderStage();
        }
      };
      img.src = urls[idx];
      preloadCache.set(idx, img);
    }

    function preloadAround(idx) {
      for (let i = 1; i <= settings.preloadAhead; i++) preloadPage(idx + i);
      preloadPage(idx - 1);
    }

    // --- Stage Rendering ---

    let stripObserver = null;
    let stripRendered = false;

    function createImageElement(idx, priority = false) {
      const slot = document.createElement('div');
      slot.className = 'cms-page-slot';
      slot.dataset.page = String(idx);

      const img = document.createElement('img');
      img.className = 'cms-page-img';
      img.alt = `第 ${idx + 1} 页`;
      img.decoding = 'async';
      if (priority) {
        img.fetchPriority = 'high';
      } else {
        img.loading = 'lazy';
      }

      const stateBox = document.createElement('div');
      stateBox.className = 'cms-page-state';
      stateBox.innerHTML = `<div class="cms-spinner"></div><span>正在加载第 ${idx + 1} 页…</span>`;

      const showError = () => {
        img.style.display = 'none';
        stateBox.style.display = 'flex';
        stateBox.innerHTML = `
          <span>第 ${idx + 1} 页加载失败</span>
          <button type="button" class="cms-btn cms-btn-primary">${ICONS.retry}<span>重试</span></button>
        `;
        stateBox.querySelector('button').addEventListener('click', (e) => {
          e.stopPropagation();
          stateBox.innerHTML = `<div class="cms-spinner"></div><span>正在重试…</span>`;
          img.src = urls[idx] + (urls[idx].includes('?') ? '&' : '?') + '_r=' + Date.now();
        });
      };

      const finalizeVisual = (isCached) => {
        stateBox.style.display = 'none';
        let visualEl = img;
        if (typeof adapter.renderCanvas === 'function') {
          try {
            const canvas = adapter.renderCanvas(img, urls[idx], extracted);
            if (canvas) {
              canvas.className = 'cms-page-img';
              canvas.setAttribute('aria-label', `第 ${idx + 1} 页`);
              img.replaceWith(canvas);
              visualEl = canvas;
            }
          } catch (err) {
            console.warn('[MangaReader+] Canvas unscramble fallback to raw img:', err);
          }
        }
        visualEl.style.display = 'block';
        if (!isCached) {
          visualEl.classList.add('is-entering');
          requestAnimationFrame(() => visualEl.classList.add('is-loaded'));
        }
        const isWide = img.naturalWidth > img.naturalHeight * 1.12;
        const prev = pageDimensions.get(idx);
        pageDimensions.set(idx, { w: img.naturalWidth, h: img.naturalHeight, isWide });
        if (!prev && isWide && settings.mode === 'double') {
          renderStage();
        }
      };

      img.onload = () => finalizeVisual(false);
      img.onerror = showError;
      img.style.display = 'none';
      slot.appendChild(stateBox);
      slot.appendChild(img);
      img.src = urls[idx];

      if (img.complete && img.naturalWidth > 0) {
        finalizeVisual(true);
      }

      return slot;
    }

    function applyStageClasses(isDoublePair = false) {
      stage.className = 'cms-stage';
      stage.classList.add(`mode-${settings.mode}`);
      stage.classList.add(`fit-${settings.fit}`);
      if (isDoublePair) stage.classList.add('is-double-pair');
      if (settings.fit === 'width' || settings.fit === 'original' || settings.fit === 'custom') {
        stage.classList.add('is-scrollable-top');
      }
      stage.style.setProperty('--cms-zoom', String(settings.zoom));
      stage.style.setProperty('--cms-strip-gap', `${settings.stripGap}px`);

      const enableClick = settings.mode !== 'strip' && settings.clickZones !== 'off';
      clickLayer.classList.toggle('active', enableClick);
    }

    function renderStage(preserveStripScroll = false) {
      if (settings.mode === 'strip') {
        applyStageClasses(false);
        if (!stripRendered) {
          stage.innerHTML = '';
          const list = document.createElement('div');
          list.className = 'cms-strip-list';

          for (let i = 0; i < total; i++) {
            const item = document.createElement('div');
            item.className = 'cms-strip-item';
            item.dataset.page = String(i);
            item.appendChild(createImageElement(i, Math.abs(i - currentIndex) <= 1));
            list.appendChild(item);
          }

          const endCard = document.createElement('div');
          endCard.className = 'cms-chapter-end';
          const endTitle = document.createElement('div');
          endTitle.style.cssText = 'font-weight: 600; font-size: 14px;';
          endTitle.textContent = `本话结束：${meta.chapterTitle || '当前章节'}`;
          const endActions = document.createElement('div');
          endActions.className = 'cms-chapter-end-actions';
          endActions.innerHTML = `
            ${meta.prevHref ? `<a class="cms-btn" href="${meta.prevHref}">${ICONS.prev}<span>上一话</span></a>` : ''}
            <a class="cms-btn" href="${meta.tocHref}">漫画目录</a>
            ${meta.nextHref ? `<a class="cms-btn cms-btn-primary" href="${meta.nextHref}"><span>下一话</span>${ICONS.next}</a>` : ''}
          `;
          endCard.appendChild(endTitle);
          endCard.appendChild(endActions);
          list.appendChild(endCard);
          stage.appendChild(list);
          stripRendered = true;

          if (stripObserver) stripObserver.disconnect();
          stripObserver = new IntersectionObserver(
            (entries) => {
              let best = null;
              for (const entry of entries) {
                if (entry.isIntersecting) {
                  if (!best || entry.intersectionRatio > best.intersectionRatio) {
                    best = entry;
                  }
                }
              }
              if (best) {
                const p = parseInt(best.target.dataset.page, 10);
                if (!Number.isNaN(p) && p !== currentIndex) {
                  currentIndex = p;
                  saveProgress(meta.chapterKey, currentIndex);
                  updateHudCounters();
                }
              }
            },
            { root: stage, threshold: [0.15, 0.5] }
          );
          list.querySelectorAll('.cms-strip-item').forEach((el) => stripObserver.observe(el));

          if (!preserveStripScroll) {
            const target = list.querySelector(`.cms-strip-item[data-page="${currentIndex}"]`);
            if (target) target.scrollIntoView({ behavior: 'instant', block: 'start' });
          }
        }
        updateHudCounters();
        return;
      }

      stripRendered = false;
      if (stripObserver) {
        stripObserver.disconnect();
        stripObserver = null;
      }

      const spreadIndices = getSpreadIndices(currentIndex);
      currentIndex = spreadIndices[0];
      const isDoublePair = spreadIndices.length === 2;

      applyStageClasses(isDoublePair);

      stage.innerHTML = '';
      const spreadEl = document.createElement('div');
      spreadEl.className = `cms-spread dir-${settings.direction}`;

      spreadIndices.forEach((idx) => {
        spreadEl.appendChild(createImageElement(idx, true));
      });

      stage.appendChild(spreadEl);
      stage.scrollTop = 0;

      saveProgress(meta.chapterKey, currentIndex);
      updateHudCounters(spreadIndices);
      preloadAround(spreadIndices[spreadIndices.length - 1]);
    }

    // --- HUD & Settings Sync ---

    function updateHudCounters(spreadIndices = null) {
      const indices = spreadIndices || (settings.mode === 'double' ? getSpreadIndices(currentIndex) : [currentIndex]);
      const label = indices.length === 2
        ? `${indices[0] + 1}–${indices[1] + 1}`
        : `${indices[0] + 1}`;

      counterEl.innerHTML = `<strong>${label}</strong> / ${total}`;
      miniBadge.textContent = `${label} / ${total}`;

      const isRtlBar = settings.direction === 'rtl' && settings.mode !== 'strip';
      const pct = total > 1 ? (indices[indices.length - 1] / (total - 1)) * 100 : 100;

      scrubber.value = String(indices[0] + 1);
      scrubberFill.style.width = `${pct}%`;
      scrubberWrap.classList.toggle('dir-rtl', isRtlBar);

      if (isRtlBar) {
        scrubberThumb.style.left = 'auto';
        scrubberThumb.style.right = `${pct}%`;
      } else {
        scrubberThumb.style.right = 'auto';
        scrubberThumb.style.left = `${pct}%`;
      }

      hairlineEl.classList.toggle('dir-rtl', isRtlBar);
      hairlineFill.style.width = `${pct}%`;
    }

    function syncSettingsUI() {
      root.dataset.theme = settings.theme;
      root.classList.toggle('has-progress-line', settings.progressLine);

      popover.querySelectorAll('.cms-seg').forEach((seg) => {
        const key = seg.dataset.setting;
        seg.querySelectorAll('.cms-seg-btn').forEach((btn) => {
          const val = key === 'stripGap' ? Number(btn.dataset.value) : btn.dataset.value;
          btn.setAttribute('aria-pressed', String(settings[key] === val));
        });
      });

      popover.querySelectorAll('.cms-swatch').forEach((btn) => {
        btn.setAttribute('aria-pressed', String(settings.theme === btn.dataset.value));
      });

      zoomRange.value = String(settings.zoom);
      zoomVal.textContent = `${settings.zoom}%`;
      optCover.checked = settings.coverOffset;
      optWide.checked = settings.autoWideSpread;
      optWheel.checked = settings.wheelPaging;
      optProgress.checked = settings.progressLine;

      root.querySelector('#cms-strip-gap-field').style.display = settings.mode === 'strip' ? 'flex' : 'none';

      const modeNames = { single: '单页', double: '双页', strip: '条漫' };
      const fitNames = { screen: '适应屏幕', height: '适应高度', width: '适应宽度', original: '原图 1:1', custom: `缩放 ${settings.zoom}%` };
      pillMode.textContent = modeNames[settings.mode];
      pillFit.textContent = fitNames[settings.fit];
      pillDir.textContent = settings.direction === 'rtl' ? '从右到左 ←' : '从左到右 →';
    }

    // --- Navigation Actions (Instant, Zero Animation) ---

    function goToPage(idx) {
      const target = clamp(idx, 0, total - 1);
      currentIndex = target;
      if (settings.mode === 'strip') {
        const el = stage.querySelector(`.cms-strip-item[data-page="${target}"]`);
        if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
        updateHudCounters([target]);
        saveProgress(meta.chapterKey, target);
      } else {
        renderStage();
      }
    }

    function stepPage(delta) {
      if (settings.mode === 'strip') {
        stage.scrollBy({ top: delta * stage.clientHeight * 0.85, behavior: 'smooth' });
        return;
      }

      const spread = getSpreadIndices(currentIndex);
      if (delta > 0) {
        const nextIdx = spread[spread.length - 1] + 1;
        if (nextIdx >= total) {
          if (meta.nextHref) {
            showToast('正在前往下一话…');
            location.href = meta.nextHref;
          } else {
            showToast('已是最新一话最后一页');
          }
          return;
        }
        currentIndex = nextIdx;
        renderStage();
      } else {
        const prevIdx = spread[0] - 1;
        if (prevIdx < 0) {
          if (meta.prevHref) {
            showToast('正在前往上一话…');
            location.href = meta.prevHref;
          } else {
            showToast('已是第一话第一页');
          }
          return;
        }
        currentIndex = prevIdx;
        renderStage();
      }
    }

    function toggleHud(force) {
      settings.showHud = typeof force === 'boolean' ? force : !settings.showHud;
      root.classList.toggle('hud-hidden', !settings.showHud);
      if (!settings.showHud) closePopover();
      saveSettings(settings);
    }

    function openPopover() {
      popover.classList.add('open');
      btnSettings.setAttribute('aria-expanded', 'true');
    }

    function closePopover() {
      popover.classList.remove('open');
      btnSettings.setAttribute('aria-expanded', 'false');
    }

    function togglePopover() {
      if (popover.classList.contains('open')) closePopover();
      else openPopover();
    }

    let thumbsBuilt = false;
    function openGridModal() {
      closePopover();
      if (!thumbsBuilt) {
        const frag = document.createDocumentFragment();
        urls.forEach((url, i) => {
          const card = document.createElement('button');
          card.type = 'button';
          card.className = 'cms-thumb-card';
          card.dataset.page = String(i);
          card.innerHTML = `<img src="${url}" alt="第 ${i + 1} 页" loading="lazy" decoding="async" /><span class="cms-thumb-num">${i + 1}</span>`;
          card.addEventListener('click', () => {
            gridModal.classList.remove('open');
            goToPage(i);
          });
          frag.appendChild(card);
        });
        thumbGrid.appendChild(frag);
        thumbsBuilt = true;
      }
      const activeSpread = new Set(getSpreadIndices(currentIndex));
      thumbGrid.querySelectorAll('.cms-thumb-card').forEach((card) => {
        card.classList.toggle('is-current', activeSpread.has(Number(card.dataset.page)));
      });
      gridModal.classList.add('open');
      const activeCard = thumbGrid.querySelector('.cms-thumb-card.is-current');
      if (activeCard) activeCard.scrollIntoView({ block: 'center' });
    }

    function closeAllModals() {
      closePopover();
      gridModal.classList.remove('open');
      helpModal.classList.remove('open');
    }

    function setZoom(nextZoom) {
      settings.fit = 'custom';
      settings.zoom = clamp(nextZoom, 50, 250);
      saveSettings(settings);
      syncSettingsUI();
      renderStage(true);
    }

    function toggleOriginalPage() {
      const isActive = document.body.classList.contains('cms-active');
      if (isActive) {
        document.documentElement.classList.remove('cms-active');
        document.body.classList.remove('cms-active');
        root.style.display = 'none';
        let restoreBtn = document.getElementById('cms-restore-btn');
        if (!restoreBtn) {
          restoreBtn = document.createElement('button');
          restoreBtn.id = 'cms-restore-btn';
          restoreBtn.textContent = '返回增强阅读器 (Alt+O)';
          Object.assign(restoreBtn.style, {
            position: 'fixed',
            bottom: '16px',
            right: '16px',
            zIndex: '2147483647',
            padding: '10px 14px',
            borderRadius: '10px',
            border: '1px solid rgba(255,255,255,0.16)',
            background: '#141417',
            color: '#f4f4f5',
            font: '500 13px/1 -apple-system, BlinkMacSystemFont, sans-serif',
            cursor: 'pointer',
            boxShadow: '0 10px 28px rgba(0,0,0,0.45)',
          });
          restoreBtn.addEventListener('click', toggleOriginalPage);
          document.body.appendChild(restoreBtn);
        }
        restoreBtn.style.display = 'block';
      } else {
        const restoreBtn = document.getElementById('cms-restore-btn');
        if (restoreBtn) restoreBtn.style.display = 'none';
        document.documentElement.classList.add('cms-active');
        document.body.classList.add('cms-active');
        root.style.display = 'flex';
      }
    }

    // --- Event Listeners ---

    clickLayer.addEventListener('click', (e) => {
      const zone = e.target.closest('.cms-click-zone')?.dataset.zone;
      if (!zone) return;
      if (popover.classList.contains('open')) {
        closePopover();
        return;
      }
      if (zone === 'center') {
        toggleHud();
        return;
      }
      if (settings.clickZones === 'next') {
        stepPage(1);
        return;
      }
      const isNext = settings.direction === 'rtl' ? zone === 'left' : zone === 'right';
      stepPage(isNext ? 1 : -1);
    });

    stage.addEventListener('click', (e) => {
      if (e.target.closest('button, a')) return;
      if (popover.classList.contains('open')) {
        closePopover();
        return;
      }
      if (settings.mode === 'strip' || settings.clickZones === 'off') {
        toggleHud();
      }
    });

    let wheelLock = 0;
    stage.addEventListener(
      'wheel',
      (e) => {
        if (e.ctrlKey) {
          e.preventDefault();
          const delta = e.deltaY < 0 ? 10 : -10;
          setZoom(settings.zoom + delta);
          showToast(`缩放 ${settings.zoom}%`);
          return;
        }

        if (settings.mode === 'strip' || !settings.wheelPaging) return;
        const canScrollVertically = stage.scrollHeight > stage.clientHeight + 4;
        if (canScrollVertically) {
          const atTop = stage.scrollTop <= 2;
          const atBottom = stage.scrollTop + stage.clientHeight >= stage.scrollHeight - 2;
          if (e.deltaY > 0 && !atBottom) return;
          if (e.deltaY < 0 && !atTop) return;
        }

        e.preventDefault();
        const now = Date.now();
        if (now - wheelLock < 180) return;
        wheelLock = now;
        stepPage(e.deltaY > 0 ? 1 : -1);
      },
      { passive: false }
    );

    scrubber.addEventListener('input', () => {
      goToPage(parseInt(scrubber.value, 10) - 1);
    });

    scrubberWrap.addEventListener('mousemove', (e) => {
      const rect = scrubberWrap.getBoundingClientRect();
      let ratio = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      const displayRatio = ratio;
      if (settings.direction === 'rtl' && settings.mode !== 'strip') {
        ratio = 1 - ratio;
      }
      const pageNum = Math.round(ratio * (total - 1)) + 1;
      scrubberTip.textContent = `${pageNum} / ${total}`;
      scrubberTip.style.left = `${displayRatio * 100}%`;
    });

    btnSettings.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePopover();
    });
    root.querySelector('#cms-pop-close').addEventListener('click', closePopover);
    root.querySelector('#cms-btn-grid').addEventListener('click', openGridModal);
    root.querySelector('#cms-btn-help').addEventListener('click', () => {
      closePopover();
      helpModal.classList.add('open');
    });
    root.querySelector('#cms-btn-original').addEventListener('click', toggleOriginalPage);
    root.querySelector('#cms-btn-fullscreen').addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => {});
      } else {
        document.exitFullscreen?.().catch(() => {});
      }
    });

    root.querySelector('#cms-grid-first').addEventListener('click', () => {
      gridModal.classList.remove('open');
      goToPage(0);
    });
    root.querySelector('#cms-grid-last').addEventListener('click', () => {
      gridModal.classList.remove('open');
      goToPage(total - 1);
    });

    pillMode.addEventListener('click', () => {
      const order = ['single', 'double', 'strip'];
      settings.mode = order[(order.indexOf(settings.mode) + 1) % order.length];
      saveSettings(settings);
      syncSettingsUI();
      renderStage();
      showToast(`阅读模式：${pillMode.textContent}`);
    });

    pillFit.addEventListener('click', () => {
      const order = ['screen', 'height', 'width', 'original'];
      const idx = order.indexOf(settings.fit);
      settings.fit = order[(idx + 1) % order.length];
      saveSettings(settings);
      syncSettingsUI();
      renderStage(true);
      showToast(`画面适配：${pillFit.textContent}`);
    });

    pillDir.addEventListener('click', () => {
      settings.direction = settings.direction === 'rtl' ? 'ltr' : 'rtl';
      saveSettings(settings);
      syncSettingsUI();
      renderStage(true);
      showToast(`翻页方向：${settings.direction === 'rtl' ? '从右到左' : '从左到右'}`);
    });

    popover.addEventListener('click', (e) => {
      const btn = e.target.closest('.cms-seg-btn, .cms-swatch');
      if (!btn) return;
      const group = btn.closest('[data-setting]');
      if (!group) return;
      const key = group.dataset.setting;
      const raw = btn.dataset.value;
      settings[key] = key === 'stripGap' ? Number(raw) : raw;
      saveSettings(settings);
      syncSettingsUI();
      renderStage(key === 'fit' || key === 'stripGap' || key === 'theme');
    });

    zoomRange.addEventListener('input', () => setZoom(Number(zoomRange.value)));
    root.querySelector('#cms-zoom-dec').addEventListener('click', () => setZoom(settings.zoom - 10));
    root.querySelector('#cms-zoom-inc').addEventListener('click', () => setZoom(settings.zoom + 10));
    zoomVal.addEventListener('click', () => {
      settings.fit = 'screen';
      settings.zoom = 100;
      saveSettings(settings);
      syncSettingsUI();
      renderStage(true);
      showToast('已重置为适应屏幕');
    });

    optCover.addEventListener('change', () => {
      settings.coverOffset = optCover.checked;
      saveSettings(settings);
      renderStage();
    });

    optWide.addEventListener('change', () => {
      settings.autoWideSpread = optWide.checked;
      saveSettings(settings);
      renderStage();
    });

    optWheel.addEventListener('change', () => {
      settings.wheelPaging = optWheel.checked;
      saveSettings(settings);
    });

    optProgress.addEventListener('change', () => {
      settings.progressLine = optProgress.checked;
      saveSettings(settings);
      syncSettingsUI();
    });

    [gridModal, helpModal].forEach((modal) => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal || e.target.closest('[data-close-modal]')) {
          modal.classList.remove('open');
        }
      });
    });

    // Keyboard shortcuts (capture phase so site-native key handlers don't conflict)
    window.addEventListener('keydown', (e) => {
      if (e.target.closest('input:not([type="range"]), textarea, select')) return;

      if (e.altKey && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        toggleOriginalPage();
        return;
      }

      if (!document.body.classList.contains('cms-active')) return;

      if (e.key === 'Escape') {
        if (popover.classList.contains('open') || gridModal.classList.contains('open') || helpModal.classList.contains('open')) {
          e.preventDefault();
          e.stopImmediatePropagation();
          closeAllModals();
        }
        return;
      }

      if (gridModal.classList.contains('open') || helpModal.classList.contains('open')) return;

      const isRtl = settings.direction === 'rtl';
      let handled = true;

      switch (e.key) {
        case 'ArrowLeft':
        case 'a':
        case 'A':
          stepPage(isRtl ? 1 : -1);
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          stepPage(isRtl ? -1 : 1);
          break;
        case ' ':
          stepPage(e.shiftKey ? -1 : 1);
          break;
        case '[':
          if (meta.prevHref) location.href = meta.prevHref;
          else showToast('没有上一话了');
          break;
        case ']':
          if (meta.nextHref) location.href = meta.nextHref;
          else showToast('没有下一话了');
          break;
        case '1':
          settings.mode = 'single';
          saveSettings(settings);
          syncSettingsUI();
          renderStage();
          showToast('单页模式');
          break;
        case '2':
          settings.mode = 'double';
          saveSettings(settings);
          syncSettingsUI();
          renderStage();
          showToast('双页模式');
          break;
        case '3':
          settings.mode = 'strip';
          saveSettings(settings);
          syncSettingsUI();
          renderStage();
          showToast('条漫模式');
          break;
        case 'f':
          pillFit.click();
          break;
        case 'F':
          if (e.shiftKey) root.querySelector('#cms-btn-fullscreen').click();
          else handled = false;
          break;
        case 'r':
        case 'R':
          pillDir.click();
          break;
        case 'c':
        case 'C':
          settings.coverOffset = !settings.coverOffset;
          saveSettings(settings);
          syncSettingsUI();
          renderStage();
          showToast(`封面单显：${settings.coverOffset ? '开' : '关'}`);
          break;
        case 'h':
        case 'H':
          toggleHud();
          break;
        case 's':
        case 'S':
          if (!settings.showHud) toggleHud(true);
          togglePopover();
          break;
        case 'g':
        case 'G':
          openGridModal();
          break;
        case '?':
          closePopover();
          helpModal.classList.add('open');
          break;
        case '+':
        case '=':
          setZoom(settings.zoom + 15);
          showToast(`缩放 ${settings.zoom}%`);
          break;
        case '-':
        case '_':
          setZoom(settings.zoom - 15);
          showToast(`缩放 ${settings.zoom}%`);
          break;
        case '0':
          settings.fit = 'screen';
          settings.zoom = 100;
          saveSettings(settings);
          syncSettingsUI();
          renderStage(true);
          showToast('适应屏幕');
          break;
        default:
          handled = false;
      }

      if (handled) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }, true);

    syncSettingsUI();
    renderStage();
  }

  if (document.readyState === 'complete' || window.contentKey || window._gallery) {
    init();
  } else {
    window.addEventListener('load', init, { once: true });
  }
})();
