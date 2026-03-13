/**
 * Content page script: nav toggle and background parallax.
 */

if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}
window.scrollTo(0, 0);

const navToggle = document.getElementById('site-nav-toggle');
const navLinks = document.querySelector('.site-nav-links');

if (navToggle && navLinks) {
  navToggle.addEventListener('click', () => {
    navLinks.classList.toggle('is-open');
    navToggle.setAttribute('aria-expanded', navLinks.classList.contains('is-open') ? 'true' : 'false');
  });
}

const root = document.documentElement;
const mq = window.matchMedia('(pointer: fine)');

if (mq.matches) {
  document.addEventListener('pointermove', (e) => {
    const xNorm = (e.clientX / window.innerWidth - 0.5) * 2;
    const yNorm = (e.clientY / window.innerHeight - 0.5) * 2;
    const bx = -xNorm * 18;
    const by = -yNorm * 12;
    root.style.setProperty('--px1', `${(bx * 0.55).toFixed(2)}px`);
    root.style.setProperty('--py1', `${(by * 0.55).toFixed(2)}px`);
    root.style.setProperty('--px2', `${(bx * 1.45).toFixed(2)}px`);
    root.style.setProperty('--py2', `${(by * 1.45).toFixed(2)}px`);
  });
}
