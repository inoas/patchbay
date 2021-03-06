const nest = require('depnest')
const dataurl = require('dataurl-')
const hyperfile = require('hyperfile')
const hypercrop = require('hypercrop')
const hyperlightbox = require('hyperlightbox')
const Mutual = require('ssb-mutual')

const {
  h, Value, Dict: MutantObject, Struct,
  map, computed, when, dictToCollection
} = require('mutant')
const pull = require('pull-stream')

exports.gives = nest('about.html.edit')

exports.needs = nest({
  'about.obs': {
    name: 'first',
    imageUrl: 'first',
    description: 'first'
  },
  'about.obs.groupedValues': 'first',
  'blob.sync.url': 'first',
  'keys.sync.id': 'first',
  'message.html.confirm': 'first',
  'message.html.markdown': 'first',
  sbot: {
    'async.addBlob': 'first',
    'obs.connection': 'first',
    'pull.links': 'first'
  }
})

exports.create = function (api) {
  return nest({
    'about.html.edit': edit
  })

  // TODO refactor this to use obs better
  function edit (id) {
    // TODO - get this to wait till the connection is present !
    var mutual = Mutual.init(api.sbot.obs.connection())

    var avatar = Struct({
      current: api.about.obs.imageUrl(id),
      new: MutantObject()
    })

    const links = api.sbot.pull.links

    var name = Struct({
      current: api.about.obs.name(id),
      new: Value()
    })

    const images = computed(api.about.obs.groupedValues(id, 'image'), Object.keys)

    var namesRecord = MutantObject()
    // TODO constrain query to one name per peer?
    pull(
      links({dest: id, rel: 'about', values: true}),
      pull.map(e => e.value.content.name),
      pull.filter(Boolean),
      pull.drain(name => {
        var n = namesRecord.get(name) || 0
        namesRecord.put(name, n + 1)
      })
    )
    var names = dictToCollection(namesRecord)

    var lightbox = hyperlightbox()

    var isPossibleUpdate = computed([name.new, avatar.new], (name, avatar) => {
      return name || avatar.link
    })

    var avatarSrc = computed([avatar], avatar => {
      if (avatar.new.link) return api.blob.sync.url(avatar.new.link)
      return avatar.current
    })

    var displayedName = computed([name], name => {
      if (name.new) return name.new
      else return name.current
    })


    var balances_div = h('div.balances')

    mutual.getAccountBalances(id, (error, balances) => {
      if (balances == null) return ''

      var balance_els = [];
      Object.keys(balances).forEach(function(key) {
        balances_div.appendChild(
          h('div', `💰 ${balances[key]} ${key}`)
        )
      });
    })

    return h('AboutEditor', [
      lightbox,
      h('section.avatar', [
        h('section', [
          h('img', { src: avatarSrc })
        ]),
        h('footer', displayedName)
      ]),
      h('section.description', computed(api.about.obs.description(id), (descr) => {
        if (descr == null) return '' // TODO: should be in patchcore, I think...
        return api.message.html.markdown(descr)
      })),
      h('section.credit', balances_div),
      h('section.aliases', [
        h('header', 'Aliases'),
        h('section.avatars', [
          h('header', 'Avatars'),
          map(images, image => h('img', {
            'src': api.blob.sync.url(image),
            'ev-click': () => avatar.new.set({ link: image })
          })),
          h('div.file-upload', [
            hyperfile.asDataURL(dataUrlCallback)
          ])
        ]),
        h('section.names', [
          h('header', 'Names'),
          h('section', [
            map(names, n => h('div', { 'ev-click': () => name.new.set(n.key()) }, [
              h('div.name', n.key),
              h('div.count', n.value)
            ])),
            h('input', {
              placeholder: ' + another name',
              'ev-keyup': e => name.new.set(e.target.value)
            })
          ])
        ]),
        when(isPossibleUpdate, h('section.action', [
          h('button.cancel', { 'ev-click': clearNewSelections }, 'cancel'),
          h('button.confirm', { 'ev-click': handleUpdateClick }, 'confirm changes')
        ]))
      ])
    ])

    function dataUrlCallback (data) {
      const cropCallback = (err, cropData) => {
        if (err) throw err
        if (!cropData) return lightbox.close()

        var _data = dataurl.parse(cropData)
        api.sbot.async.addBlob(pull.once(_data.data), (err, hash) => {
          if (err) throw err // TODO check if this is safely caught by error catcher

          avatar.new.set({
            link: hash,
            size: _data.data.length,
            type: _data.mimetype,
            width: 512,
            height: 512
          })
        })
        lightbox.close()
      }

      const cropEl = Crop(data, cropCallback)
      lightbox.show(cropEl)
    }

    function Crop (data, cb) {
      var img = h('img', {src: data})

      var crop = h('div')

      waitForImg()

      return h('div.cropper', [
        crop,
        h('div.background')
      ])

      function waitForImg () {
        // WEIRDNESS - if you invoke hypecrop before img is ready,
        // the canvas instantiates and draws nothing

        if (!img.height && !img.width) {
          return window.setTimeout(waitForImg, 100)
        }

        var canvas = hypercrop(img)
        crop = (
          h('PatchProfileCrop', [
            h('header', 'click and drag to crop your image'),
            canvas,
            h('section.actions', [
              h('Button', { 'ev-click': () => cb() }, 'Cancel'),
              h('Button -primary', { 'ev-click': () => cb(null, canvas.selection.toDataURL()) }, 'Okay')
            ])
          ])
        )
      }
    }

    function clearNewSelections () {
      name.new.set(null)
      avatar.new.set({})
    }

    function handleUpdateClick () {
      const newName = name.new()
      const newAvatar = avatar.new()

      const msg = {
        type: 'about',
        about: id
      }

      if (newName) msg.name = newName
      if (newAvatar.link) msg.image = newAvatar

      api.message.html.confirm(msg, (err, data) => {
        if (err) return console.error(err)

        clearNewSelections()

        // TODO - update aliases displayed
      })
    }
  }
}

