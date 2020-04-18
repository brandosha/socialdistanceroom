function includeJSAssets() {
  assets.js.forEach(name => {
    const newEl = document.createElement('script')
    newEl.src = '/js/' + name + '.js?v=' + assets.version
    newEl.async = false
    newEl.defer = true
    document.head.appendChild(newEl)
  })
}
function includeCSSAssets() {
  assets.css.forEach(name => {
    const newEl = document.createElement('link')
    newEl.rel = 'stylesheet'
    newEl.href = '/css/' + name + '.css?v=' + assets.version
    document.head.appendChild(newEl)
  })
}

includeCSSAssets()
window.addEventListener('DOMContentLoaded', includeJSAssets)