(() => {
  const markup = `
    <div class="orbit-public-footer__top">
      <a class="logo" href="/"><span class="logo-orbit">O</span>Orbit</a>
      <p>Human intelligence for organisations.</p>
    </div>
    <div class="orbit-public-footer__grid">
      <section><h2>Products</h2><a href="/orbit-360/feedback.html">360 Degree Feedback</a><a href="/orbit-360/learning.html">Orbit Learning</a><a href="/orbit-360/coming-soon.html?product=growth">Orbit Growth <span>In development</span></a><a href="/orbit-360/coming-soon.html?product=competency">Competency Management <span>In development</span></a></section>
      <section><h2>Explore</h2><a href="/#workflow">The intelligence layer</a><a href="/#platform">Product suite</a><a href="/orbit-360/corporate.html#demo">Request a product conversation</a></section>
      <section><h2>Trust</h2><a href="/orbit-360/privacy.html">Privacy notice</a><a href="/orbit-360/terms.html">Terms of use</a><a href="/orbit-360/cookies.html">Cookie notice</a><a href="/orbit-360/security.html">Security & responsible disclosure</a></section>
    </div>
    <div class="orbit-public-footer__bottom"><span>© <span data-orbit-year></span> Orbit. All rights reserved.</span><span>India-first product policy drafts · legal review pending before external launch.</span></div>`;
  document.querySelectorAll('[data-orbit-footer]').forEach((footer) => {
    footer.className = 'orbit-public-footer';
    footer.innerHTML = markup;
  });
  document.querySelectorAll('[data-orbit-year]').forEach((element) => { element.textContent = String(new Date().getFullYear()); });
})();
