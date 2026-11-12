/* Progressive enhancement for server-rendered pages. Everything is driven by data- attributes; pages work without it. */
(() => {
  'use strict';

  const doc = document;
  const matches = (query) => (window.matchMedia ? window.matchMedia(query).matches : false);
  const prefersReducedMotion = () => matches('(prefers-reduced-motion: reduce)');
  const isNarrow = () => matches('(max-width: 900px)');
  const closestFrom = (target, selector) => (target instanceof Element ? target.closest(selector) : null);

  /* Selects and inputs that submit their form on change */
  doc.addEventListener('change', (event) => {
    const field = closestFrom(event.target, '[data-autosubmit]');
    const form = field && (field.form || field.closest('form'));
    if (!form) return;
    if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else form.submit();
  });

  /* Forms that ask for confirmation first */
  doc.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const message = form.getAttribute('data-confirm');
    if (message && !window.confirm(message)) event.preventDefault();
  });

  /* Flash messages */
  const removeFlash = (flash, animate) => {
    if (!flash || !flash.isConnected) return;
    const container = flash.parentElement;
    const finish = () => {
      flash.remove();
      if (container && container.classList.contains('flashes') && !container.children.length) container.remove();
    };
    if (!animate || prefersReducedMotion()) {
      finish();
      return;
    }
    flash.classList.add('flash-out');
    window.setTimeout(finish, 320);
  };

  // Success messages tidy themselves away; hovering or focusing one keeps it on screen.
  const autoHide = (flash) => {
    let timer = 0;
    const start = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => removeFlash(flash, true), 6000);
    };
    const stop = () => window.clearTimeout(timer);
    flash.addEventListener('mouseenter', stop);
    flash.addEventListener('focusin', stop);
    flash.addEventListener('mouseleave', start);
    flash.addEventListener('focusout', start);
    start();
  };
  doc.querySelectorAll('.flash-green').forEach(autoHide);

  /* Off-canvas sidebar */
  const sidebarToggles = () => Array.from(doc.querySelectorAll('[data-toggle="sidebar"]'));
  const panelFor = (button) => {
    const id = button.getAttribute('aria-controls');
    return id ? doc.getElementById(id) : null;
  };
  const setSidebar = (panel, open) => {
    panel.classList.toggle('open', open);
    sidebarToggles().forEach((button) => {
      if (panelFor(button) === panel) button.setAttribute('aria-expanded', String(open));
    });
    doc.body.classList.toggle('nav-open', doc.querySelector('.sidebar.open') !== null);
  };
  const closeSidebars = (returnFocus) => {
    sidebarToggles().forEach((button) => {
      const panel = panelFor(button);
      if (!panel || !panel.classList.contains('open')) return;
      const hadFocus = panel.contains(doc.activeElement);
      setSidebar(panel, false);
      if ((returnFocus || hadFocus) && typeof button.focus === 'function') button.focus();
    });
  };

  doc.addEventListener('click', (event) => {
    const target = event.target;

    const toggle = closestFrom(target, '[data-toggle="sidebar"]');
    if (toggle) {
      const panel = panelFor(toggle);
      if (!panel) return;
      const open = !panel.classList.contains('open');
      setSidebar(panel, open);
      if (open) {
        const first = panel.querySelector('a[href], button, select, input');
        if (first) first.focus();
      }
      return;
    }

    if (doc.querySelector('.sidebar.open') && isNarrow()) {
      const inside = closestFrom(target, '.sidebar');
      if (!inside || closestFrom(target, '.sidebar a[href]')) closeSidebars(false);
    }

    const dismiss = closestFrom(target, '[data-dismiss]');
    if (dismiss) {
      removeFlash(dismiss.closest('.flash'), false);
      return;
    }

    if (closestFrom(target, '[data-print]')) {
      window.print();
      return;
    }

    const copier = closestFrom(target, '[data-copy-target], [data-copy-text]');
    if (copier) {
      event.preventDefault();
      copyFrom(copier);
    }
  });

  doc.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && doc.querySelector('.sidebar.open')) closeSidebars(true);
  });

  if (window.matchMedia) {
    const wide = window.matchMedia('(min-width: 901px)');
    const onChange = (event) => {
      if (event.matches) closeSidebars(false);
    };
    if (typeof wide.addEventListener === 'function') wide.addEventListener('change', onChange);
    else if (typeof wide.addListener === 'function') wide.addListener(onChange);
  }

  /* Copy to clipboard */
  let liveRegion = null;
  const announce = (message) => {
    if (!liveRegion) {
      liveRegion = doc.createElement('div');
      liveRegion.className = 'sr-only';
      liveRegion.setAttribute('role', 'status');
      liveRegion.setAttribute('aria-live', 'polite');
      doc.body.appendChild(liveRegion);
    }
    liveRegion.textContent = '';
    window.setTimeout(() => { liveRegion.textContent = message; }, 50);
  };

  const writeClipboard = async (text) => {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function' && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (error) {
        /* fall through to the legacy path */
      }
    }
    const previous = doc.activeElement;
    const area = doc.createElement('textarea');
    area.value = text;
    area.className = 'sr-only';
    area.setAttribute('readonly', '');
    area.setAttribute('aria-hidden', 'true');
    doc.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, text.length);
    let ok = false;
    try {
      ok = doc.execCommand('copy');
    } catch (error) {
      ok = false;
    }
    area.remove();
    if (previous && typeof previous.focus === 'function') previous.focus({ preventScroll: true });
    return ok;
  };

  const selectContents = (element) => {
    if (typeof element.select === 'function') {
      element.select();
    } else if (window.getSelection && doc.createRange) {
      const range = doc.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
  };

  const flashLabel = (button, label) => {
    if (button.dataset.copyLabel === undefined) button.dataset.copyLabel = button.textContent;
    button.textContent = label;
    window.clearTimeout(Number(button.dataset.copyTimer) || 0);
    button.dataset.copyTimer = String(window.setTimeout(() => {
      button.textContent = button.dataset.copyLabel;
      delete button.dataset.copyLabel;
      delete button.dataset.copyTimer;
    }, 1800));
  };

  async function copyFrom(button) {
    let text = button.getAttribute('data-copy-text');
    let source = null;
    if (text === null) {
      const selector = button.getAttribute('data-copy-target');
      try {
        source = selector ? doc.querySelector(selector) : null;
      } catch (error) {
        source = null;
      }
      if (!source) return;
      text = 'value' in source && typeof source.value === 'string' ? source.value : (source.textContent || '').trim();
    }
    if (await writeClipboard(text)) {
      flashLabel(button, 'Copied');
      announce('Copied to the clipboard');
    } else {
      if (source) selectContents(source);
      flashLabel(button, 'Copy failed');
      announce('Copy failed. The text is selected so you can copy it yourself.');
    }
  }

  /* Contents lists (.plan-toc) mark the section being read with aria-current, which the stylesheet highlights */
  const tocLinks = Array.from(doc.querySelectorAll('.plan-toc a[href^="#"]'));
  if (tocLinks.length && 'IntersectionObserver' in window) {
    const targets = tocLinks.map((link) => {
      try {
        return doc.getElementById(decodeURIComponent(link.getAttribute('href').slice(1)));
      } catch (error) {
        return null;
      }
    });
    const inView = new Set();
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) inView.add(entry.target);
        else inView.delete(entry.target);
      });
      const first = targets.findIndex((target) => target && inView.has(target));
      if (first < 0) return;
      tocLinks.forEach((link, index) => {
        if (index === first) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
      });
    }, { rootMargin: '-90px 0px -65% 0px' });
    targets.forEach((target) => {
      if (target) observer.observe(target);
    });
  }
})();
