/* global lh */
lh.init().then(function (ctx) {
  document.getElementById('org-name').textContent = ctx.org.name || ctx.org.slug

  return lh.api
    .get('courses/org_slug/' + ctx.org.slug + '/page/1/limit/10')
    .then(function (res) {
      var list = document.getElementById('courses')
      list.replaceChildren()
      if (!res.ok) {
        var error = document.getElementById('error')
        error.hidden = false
        error.textContent =
          'Could not load courses (HTTP ' + res.status + '). ' +
          'Make sure the app was granted the courses:read scope.'
        return
      }
      var courses = res.data || []
      if (courses.length === 0) {
        var empty = document.createElement('li')
        empty.className = 'muted'
        empty.textContent = 'No courses yet.'
        list.appendChild(empty)
        return
      }
      courses.forEach(function (course) {
        var item = document.createElement('li')
        item.textContent = course.name
        list.appendChild(item)
      })
    })
})
