function includeAsset(name, type) {
  let newEl
  if (type === 'js') {
    newEl = document.createElement('script')
    newEl.src = '/js/' + name + '.js?v=' + assets.version
  } else if (type === 'css') {
    newEl = document.createElement('link')
    newEl.rel = 'stylesheet'
    newEl.href = '/css/' + name + '.css?v=' + assets.version
  }

  if (newEl) document.head.appendChild(newEl)
}

assets.css.forEach(name => includeAsset(name, 'css'))
window.onload = function() {
  assets.js.forEach(name => includeAsset(name, 'js'))
}