'use strict';

// Theme + skin manager. Two orthogonal attributes on <html>:
//   data-theme = light | dark   (follows the system by default)
//   data-skin  = apple | cyberpunk | xp
// Skins override tokens only; cyberpunk is always dark, xp always light.

(function () {
  const STORAGE_KEY = 'linuxmail.appearance';
  const media = window.matchMedia('(prefers-color-scheme: dark)');

  const state = { theme: 'system', skin: 'apple' };
  try {
    Object.assign(state, JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'));
  } catch (_) { /* defaults */ }

  function effectiveTheme() {
    if (state.skin === 'cyberpunk') return 'dark';
    if (state.skin === 'xp') return 'light';
    if (state.theme === 'system') return media.matches ? 'dark' : 'light';
    return state.theme;
  }

  function apply() {
    const root = document.documentElement;
    root.setAttribute('data-theme', effectiveTheme());
    root.setAttribute('data-skin', state.skin);
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) { /* best effort */ }
  }

  media.addEventListener('change', apply);
  apply();

  window.Appearance = {
    get: () => ({ ...state }),
    setTheme(theme) { state.theme = theme; apply(); save(); },
    setSkin(skin) { state.skin = skin; apply(); save(); }
  };

  // Wire up the settings popover once the DOM exists.
  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('btn-settings');
    const pop = document.getElementById('settings-pop');
    if (!btn || !pop) return;

    function renderSegments() {
      pop.querySelectorAll('.segmented').forEach((seg) => {
        const kind = seg.dataset.kind;
        seg.querySelectorAll('button').forEach((b) => {
          b.classList.toggle('active', state[kind] === b.dataset.value);
        });
      });
      // Theme choice is fixed by cyberpunk/xp skins.
      const themeSeg = pop.querySelector('.segmented[data-kind="theme"]');
      const locked = state.skin !== 'apple';
      themeSeg.querySelectorAll('button').forEach((b) => { b.disabled = locked; });
      themeSeg.style.opacity = locked ? 0.45 : 1;
    }

    pop.querySelectorAll('.segmented button').forEach((b) => {
      b.addEventListener('click', () => {
        const kind = b.closest('.segmented').dataset.kind;
        if (kind === 'theme') window.Appearance.setTheme(b.dataset.value);
        else window.Appearance.setSkin(b.dataset.value);
        renderSegments();
      });
    });

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!pop.hidden) { pop.hidden = true; return; }
      renderSegments();
      const rect = btn.getBoundingClientRect();
      pop.hidden = false;
      pop.style.left = Math.max(8, rect.left) + 'px';
      pop.style.top = rect.bottom + 6 + 'px';
    });

    document.addEventListener('pointerdown', (e) => {
      if (!pop.hidden && !pop.contains(e.target) && e.target !== btn) pop.hidden = true;
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !pop.hidden) pop.hidden = true;
    });
  });
})();
