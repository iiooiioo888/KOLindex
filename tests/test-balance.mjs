(async () => {
  const html = await (await fetch('http://127.0.0.1:5200/')).text();
  const c = (re) => (html.match(re) || []).length;
  console.log('section:', c(/<section\b/g), '/', c(/<\/section>/g));
  console.log('div    :', c(/<div\b/g), '/', c(/<\/div>/g));
  console.log('form   :', c(/<form\b/g), '/', c(/<\/form>/g));
  console.log('main   :', c(/<main\b/g), '/', c(/<\/main>/g));
  const i = html.indexOf('id="topic-studio"');
  console.log('--- section start ---');
  console.log(html.slice(i - 40, i + 420));
  console.log('--- section end ---');
  const j = html.indexOf('</main>');
  console.log(html.slice(j - 380, j + 12));
})();
