import {
  detectMessageSurface,
  messageVisibleForSurface,
  normalizePlacementsChecked,
} from '@/shared/components/system-message-surface'

describe('system message placement (#17b port)', () => {
  describe('detectMessageSurface', () => {
    it('classifies auth pages', () => {
      expect(detectMessageSurface('/login')).to.equal('auth')
      expect(detectMessageSurface('/register')).to.equal('auth')
      expect(detectMessageSurface('/user/reset-password')).to.equal('auth')
      expect(detectMessageSurface('/user/reset-password/abc123')).to.equal(
        'auth'
      )
      expect(detectMessageSurface('/user/forgot-password')).to.equal('auth')
    })

    it('classifies the editor (IDE) by project id', () => {
      expect(detectMessageSurface('/editor/6a900f391f82ca1771fbc873')).to.equal(
        'editor'
      )
      expect(detectMessageSurface('/project/6aa269b259e66f7669428de2')).to.equal(
        'editor'
      )
      // the project LIST and admin pages are 'hub' surfaces, not the editor
      expect(detectMessageSurface('/project')).to.equal('hub')
      expect(detectMessageSurface('/admin/user')).to.equal('hub')
    })

    it('classifies workspace & admin surfaces as hub', () => {
      expect(detectMessageSurface('/')).to.equal('hub')
      expect(detectMessageSurface('/library/6aa269b259e66f7669428de2')).to.equal(
        'hub'
      )
      expect(detectMessageSurface('/user/settings')).to.equal('hub')
      expect(detectMessageSurface('/group-management')).to.equal('hub')
    })
  })

  describe('messageVisibleForSurface', () => {
    const all: any = { placements: [] }
    const none: any = { placements: undefined }
    const editorOnly: any = { placements: ['editor'] }
    const hubAuth: any = { placements: ['hub', 'auth'] }

    it('legacy messages (missing/empty placements) are visible everywhere', () => {
      for (const m of [all, none]) {
        for (const s of ['editor', 'hub', 'auth', 'app'] as const) {
          expect(messageVisibleForSurface(m, s)).to.equal(true)
        }
      }
    })

    it('scoped messages hide on non-listed surfaces', () => {
      expect(messageVisibleForSurface(editorOnly, 'editor')).to.equal(true)
      expect(messageVisibleForSurface(editorOnly, 'hub')).to.equal(false)
      expect(messageVisibleForSurface(editorOnly, 'auth')).to.equal(false)
      expect(messageVisibleForSurface(editorOnly, 'app')).to.equal(false)
    })

    it('supports multi-surface placement', () => {
      expect(messageVisibleForSurface(hubAuth, 'hub')).to.equal(true)
      expect(messageVisibleForSurface(hubAuth, 'auth')).to.equal(true)
      expect(messageVisibleForSurface(hubAuth, 'editor')).to.equal(false)
    })
  })

  describe('normalizePlacementsChecked (all-exclusive)', () => {
    it('all=true wins → empty placement list', () => {
      expect(normalizePlacementsChecked({ all: true, editor: true })).to.deep.equal(
        { all: true, placements: [] }
      )
    })

    it('keeps the selected surfaces', () => {
      expect(
        normalizePlacementsChecked({
          all: false,
          editor: true,
          hub: false,
          auth: true,
        })
      ).to.deep.equal({ all: false, placements: ['editor', 'auth'] })
    })
  })
})
