document.addEventListener('DOMContentLoaded', () => {
  // Keep the compact mobile navigation accessible and predictable.
  const toggle = document.querySelector('.menu-toggle');
  const menu = document.querySelector('.mobile-nav');
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!open));
    menu.classList.toggle('open', !open);
  });
  menu.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
    toggle.setAttribute('aria-expanded', 'false');
    menu.classList.remove('open');
  }));

  // Reveal sections once as they enter the viewport.
  const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
    if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); }
  }), { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach((element) => observer.observe(element));

  // Static-site form handoff: create a ready-to-send email without a backend.
  const contactForm = document.querySelector('#contact-form');
  if (contactForm) {
    contactForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new FormData(contactForm);
      const subject = `New ${data.get('service')} enquiry from ${data.get('name')}`;
      const body = [
        `Name: ${data.get('name')}`,
        `Email: ${data.get('email')}`,
        `Business: ${data.get('business') || 'Not provided'}`,
        `Phone: ${data.get('phone') || 'Not provided'}`,
        `Service: ${data.get('service')}`,
        '',
        'Project details:',
        data.get('message')
      ].join('\n');
      window.location.href = `mailto:lesleysacks1@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    });
  }

  const testimonials = [
    { quote: '“InterSacks took what felt like a tangle of ideas and turned it into a brand and website we are genuinely proud to put in front of people.”', author: 'Sarah M.', role: 'Founder, The Studio Collective' },
    { quote: '“The process was thoughtful, calm, and exceptionally clear. Our new system now saves the team hours every week.”', author: 'Daniel R.', role: 'Director, Horizon Projects' },
    { quote: '“They understood the feeling we wanted to create, then made it real with the kind of detail our customers notice.”', author: 'Mia K.', role: 'Owner, Field & Form' }
  ];
  const testimonialSection = document.querySelector('.testimonials');
  if (!testimonialSection) {
    document.querySelector('#year').textContent = new Date().getFullYear();
    return;
  }

  let current = 0;
  const quote = document.querySelector('#quote-text');
  const author = document.querySelector('#quote-author');
  const dots = document.querySelectorAll('.quote-progress span');
  const renderQuote = () => {
    const item = testimonials[current];
    quote.textContent = item.quote;
    author.innerHTML = `${item.author} <span>${item.role}</span>`;
    dots.forEach((dot, index) => dot.classList.toggle('active', index === current));
  };

  document.querySelector('.quote-prev').addEventListener('click', () => {
    current = (current + testimonials.length - 1) % testimonials.length;
    renderQuote();
  });
  document.querySelector('.quote-next').addEventListener('click', () => {
    current = (current + 1) % testimonials.length;
    renderQuote();
  });
  document.querySelector('#year').textContent = new Date().getFullYear();
});
