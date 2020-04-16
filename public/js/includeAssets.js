/**
 * @param { 'js' | 'css' } type 
 */
function includeAssets(type) {
  if (type === 'js') {
    function includeNext(index) {
      const name = assets.js[index]
      if (!name) return
      newEl = document.createElement('script')
      newEl.src = '/js/' + name + '.js?v=' + assets.version
      newEl.onload = () => includeNext(index + 1)
      document.head.appendChild(newEl)
    }
    includeNext(0)
  } else if (type === 'css') {
    assets.css.forEach(name => {
      const newEl = document.createElement('link')
      newEl.rel = 'stylesheet'
      newEl.href = '/css/' + name + '.css?v=' + assets.version
      document.head.appendChild(newEl)
    })
  }
}

includeAssets('css')
window.addEventListener('DOMContentLoaded', () => includeAssets('js'))