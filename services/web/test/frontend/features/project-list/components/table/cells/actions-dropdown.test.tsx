import { expect } from 'chai'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import fetchMock from 'fetch-mock'
import ActionsDropdown from '../../../../../../../frontend/js/features/project-list/components/dropdown/actions-dropdown'
import {
  trashedProject,
  trashedAndNotOwnedProject,
} from '../../../fixtures/projects-data'
import {
  renderWithProjectListContext,
  resetProjectListContextFetch,
} from '../../../helpers/render-with-context'

describe('<ActionsDropdown />', function () {
  afterEach(function () {
    resetProjectListContextFetch()
    window.metaAttributesCache.clear()
  })

  describe('Delete button for trashed project (mobile view)', function () {
    it('opens the delete modal when clicking Delete in the dropdown', async function () {
      window.metaAttributesCache.set('ol-user_id', trashedProject.owner?.id)
      const project = Object.assign({}, trashedProject)
      const deleteProjectMock = fetchMock.delete(
        `express:/project/:projectId`,
        { status: 200 },
        { delay: 0 }
      )

      renderWithProjectListContext(<ActionsDropdown project={project} />)

      const toggle = screen.getByRole('button', { name: 'Actions' })
      fireEvent.click(toggle)

      const deleteBtn = await screen.findByRole('menuitem', { name: /delete/i })
      fireEvent.click(deleteBtn)

      await screen.findByText('Delete Projects')

      const confirmBtn = screen.getByRole('button', {
        name: 'Confirm',
      }) as HTMLButtonElement
      fireEvent.click(confirmBtn)

      await waitFor(
        () =>
          expect(deleteProjectMock.callHistory.called(`/project/${project.id}`))
            .to.be.true
      )
    })
  })

  describe('Leave button for trashed non-owned project (mobile view)', function () {
    it('opens the leave modal when clicking Leave in the dropdown', async function () {
      const project = Object.assign({}, trashedAndNotOwnedProject)
      const leaveProjectMock = fetchMock.post(
        `express:/project/${project.id}/leave`,
        { status: 200 },
        { delay: 0 }
      )

      renderWithProjectListContext(<ActionsDropdown project={project} />)

      const toggle = screen.getByRole('button', { name: 'Actions' })
      fireEvent.click(toggle)

      const leaveBtn = await screen.findByRole('menuitem', { name: /leave/i })
      fireEvent.click(leaveBtn)

      await screen.findByText('Leave Projects')

      const confirmBtn = screen.getByRole('button', {
        name: 'Confirm',
      }) as HTMLButtonElement
      fireEvent.click(confirmBtn)

      await waitFor(
        () =>
          expect(
            leaveProjectMock.callHistory.called(`/project/${project.id}/leave`)
          ).to.be.true
      )
    })
  })
})
