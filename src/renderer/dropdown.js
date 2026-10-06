'use strict';

// Custom dropdown that replaces native <select> elements (WebKit/Chromium
// native popups don't follow the app theme). Progressive enhancement: the
// original select stays in the DOM (hidden) as the source of truth, so form
// code that reads `select.value` or listens for 'change' keeps working.

(function () {
  const CHEVRON =
    '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
    '<path d="M2.5 4.5L6 8l3.5-3.5" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const CHECK =
    '<svg class="check" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
    '<path d="M2 6.2L4.8 9 10 3.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  let openInstance = null;

  class Dropdown {
    constructor(select) {
      this.select = select;
      select.classList.add('enhanced');

      this.root = document.createElement('div');
      this.root.className = 'dd';

      this.trigger = document.createElement('button');
      this.trigger.type = 'button';
      this.trigger.className = 'dd-trigger';
      this.trigger.setAttribute('aria-haspopup', 'listbox');
      this.trigger.setAttribute('aria-expanded', 'false');
      this.valueEl = document.createElement('span');
      this.valueEl.className = 'dd-value';
      this.trigger.append(this.valueEl);
      this.trigger.insertAdjacentHTML('beforeend', CHEVRON);

      this.root.append(this.trigger);
      select.parentNode.insertBefore(this.root, select.nextSibling);

      this.panel = null;
      this.focusIndex = -1;

      this.trigger.addEventListener('click', () => (this.panel ? this.close() : this.open()));
      this.trigger.addEventListener('keydown', (e) => this.onTriggerKey(e));
      this.syncLabel();
    }

    options() {
      return Array.from(this.select.options);
    }

    syncLabel() {
      const opt = this.select.selectedOptions[0];
      this.valueEl.textContent = opt ? opt.textContent : '';
    }

    open() {
      if (openInstance && openInstance !== this) openInstance.close();
      openInstance = this;
      this.root.classList.add('open');
      this.trigger.setAttribute('aria-expanded', 'true');

      this.panel = document.createElement('div');
      this.panel.className = 'dd-panel';
      this.panel.setAttribute('role', 'listbox');

      this.options().forEach((opt, i) => {
        const item = document.createElement('div');
        item.className = 'dd-option';
        item.setAttribute('role', 'option');
        if (opt.selected) item.classList.add('selected');
        const label = document.createElement('span');
        label.textContent = opt.textContent;
        item.append(label);
        item.insertAdjacentHTML('beforeend', CHECK);
        item.addEventListener('click', () => this.choose(i));
        item.addEventListener('mousemove', () => this.setFocus(i));
        this.panel.append(item);
      });

      this.root.append(this.panel);
      // Flip upward if there is not enough room below.
      const rect = this.panel.getBoundingClientRect();
      if (rect.bottom > window.innerHeight - 8) this.panel.classList.add('up');

      this.setFocus(Math.max(0, this.select.selectedIndex));
      this.outsideHandler = (e) => {
        if (!this.root.contains(e.target)) this.close();
      };
      // Capture phase so clicks inside dialogs also close it.
      document.addEventListener('pointerdown', this.outsideHandler, true);
    }

    close() {
      if (!this.panel) return;
      this.panel.remove();
      this.panel = null;
      this.root.classList.remove('open');
      this.trigger.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', this.outsideHandler, true);
      if (openInstance === this) openInstance = null;
    }

    setFocus(i) {
      this.focusIndex = i;
      if (!this.panel) return;
      Array.from(this.panel.children).forEach((el, j) => {
        el.classList.toggle('focused', j === i);
      });
      const el = this.panel.children[i];
      if (el) el.scrollIntoView({ block: 'nearest' });
    }

    choose(i) {
      const opt = this.options()[i];
      if (!opt) return;
      if (this.select.selectedIndex !== i) {
        this.select.selectedIndex = i;
        this.select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      this.syncLabel();
      this.close();
      this.trigger.focus();
    }

    onTriggerKey(e) {
      const n = this.options().length;
      if (!n) return;
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          if (!this.panel) this.open();
          else this.setFocus(Math.min(n - 1, this.focusIndex + 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (!this.panel) this.open();
          else this.setFocus(Math.max(0, this.focusIndex - 1));
          break;
        case 'Home':
          if (this.panel) { e.preventDefault(); this.setFocus(0); }
          break;
        case 'End':
          if (this.panel) { e.preventDefault(); this.setFocus(n - 1); }
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (this.panel) this.choose(this.focusIndex);
          else this.open();
          break;
        case 'Escape':
          if (this.panel) { e.preventDefault(); this.close(); }
          break;
      }
    }
  }

  const registry = new Map();

  function enhance(select) {
    if (!registry.has(select)) registry.set(select, new Dropdown(select));
    return registry.get(select);
  }

  // Call after options were rebuilt or value changed programmatically.
  function sync(select) {
    const dd = registry.get(select);
    if (dd) {
      dd.close();
      dd.syncLabel();
    }
  }

  window.Dropdown = { enhance, sync };

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('select').forEach(enhance);
  });
})();
