document.addEventListener('DOMContentLoaded', () => {
  const search = document.querySelector('#resource-search');
  const filterButtons = [...document.querySelectorAll('[data-filter]')];
  const cards = [...document.querySelectorAll('[data-resource-card]')];
  const sections = [...document.querySelectorAll('[data-resource-section]')];
  const resultCount = document.querySelector('[data-result-count]');
  const emptyState = document.querySelector('[data-empty-state]');
  const toast = document.querySelector('[data-copy-toast]');
  let activeFilter = 'all';
  let toastTimer;

  const normalise = (value) => value.toLowerCase().trim();

  const applyFilters = () => {
    const query = normalise(search?.value || '');
    let visibleCount = 0;

    cards.forEach((card) => {
      const categories = (card.dataset.category || '').split(/\s+/);
      const haystack = normalise(`${card.dataset.search || ''} ${card.textContent}`);
      const categoryMatch = activeFilter === 'all' || categories.includes(activeFilter);
      const searchMatch = !query || haystack.includes(query);
      card.hidden = !(categoryMatch && searchMatch);
      if (!card.hidden) visibleCount += 1;
    });

    sections.forEach((section) => {
      const sectionCards = [...section.querySelectorAll('[data-resource-card]')];
      section.hidden = sectionCards.length > 0 && sectionCards.every((card) => card.hidden);
    });

    if (resultCount) {
      resultCount.textContent = `Showing ${visibleCount} ${visibleCount === 1 ? 'resource' : 'resources'}`;
    }
    if (emptyState) emptyState.hidden = visibleCount !== 0;
  };

  filterButtons.forEach((button) => {
    button.addEventListener('click', () => {
      activeFilter = button.dataset.filter || 'all';
      filterButtons.forEach((item) => {
        const selected = item === button;
        item.classList.toggle('active', selected);
        item.setAttribute('aria-pressed', String(selected));
      });
      applyFilters();
    });
  });

  search?.addEventListener('input', applyFilters);

  document.querySelectorAll('[data-reset-resources]').forEach((button) => {
    button.addEventListener('click', () => {
      activeFilter = 'all';
      if (search) search.value = '';
      filterButtons.forEach((item) => {
        const selected = item.dataset.filter === 'all';
        item.classList.toggle('active', selected);
        item.setAttribute('aria-pressed', String(selected));
      });
      applyFilters();
      search?.focus();
    });
  });

  const showToast = (message) => {
    if (!toast) return;
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add('visible');
    toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 2200);
  };

  const fallbackCopy = (text) => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error('Copy command was rejected.');
  };

  const copyText = async (text) => {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      fallbackCopy(text);
    }
  };

  document.querySelectorAll('[data-copy], [data-copy-target]').forEach((button) => {
    button.addEventListener('click', async () => {
      const targetId = button.dataset.copyTarget;
      const target = targetId ? document.getElementById(targetId) : null;
      const text = target ? target.textContent : button.dataset.copy;
      if (!text) return;

      const originalLabel = button.textContent;
      try {
        await copyText(text);
        button.textContent = 'Copied';
        showToast('Copied to clipboard');
      } catch (error) {
        showToast('Copy failed — select the text manually');
      } finally {
        window.setTimeout(() => { button.textContent = originalLabel; }, 1600);
      }
    });
  });

  applyFilters();
});
