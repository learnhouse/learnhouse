/**
 * Page object for the teacher's assignment dashboard: the submissions subpage
 * and the "Evaluate" grading modal. Selectors verified live against the UI:
 *   - Submissions subpage: /dash/assignments/{bareUuid}?subpage=submissions
 *   - Stats: "Total/Late/Submitted/Graded" with counts.
 *   - Status filter buttons: "All N", "Late N", "Submitted N", "Graded N".
 *   - Search: placeholder "Search by name or email...".
 *   - Each row has an "Evaluate" control opening the grading modal.
 *   - Modal: per-task "Full"/"Half"/"Zero" + a "Grade" apply control, a
 *     per-task note, an overall-feedback textbox, and the action buttons
 *     "Reject Assignment", "Set final grade", "Finalize & Complete".
 */
import { Page, Locator, expect } from '@playwright/test'
import { BASE_URL } from '../../../core/instance'

export class TeacherSubmissionsPage {
  constructor(private readonly page: Page) {}

  /** Open the submissions subpage. Pass the BARE assignment uuid (no prefix). */
  async open(bareAssignmentUuid: string): Promise<void> {
    await this.page.goto(
      `${BASE_URL}/dash/assignments/${bareAssignmentUuid}?subpage=submissions`,
    )
    await expect(this.page.getByText('Total', { exact: true }).first()).toBeVisible({
      timeout: 20_000,
    })
  }

  /** Read a stat count by its label (Total/Late/Submitted/Graded). */
  async statCount(label: 'Total' | 'Late' | 'Submitted' | 'Graded'): Promise<number> {
    // Each stat is a label paragraph followed by a count paragraph.
    const value = this.page
      .locator('p', { hasText: new RegExp(`^${label}$`) })
      .first()
      .locator('xpath=following-sibling::p[1]')
    const txt = (await value.textContent().catch(() => '')) || ''
    return parseInt(txt.trim() || '0', 10)
  }

  /** Click a status filter button (e.g. "Submitted"). */
  async filter(status: 'All' | 'Late' | 'Submitted' | 'Graded'): Promise<void> {
    await this.page.getByRole('button', { name: new RegExp(`^${status}\\s*\\d*$`) }).first().click()
    await this.page.waitForTimeout(600)
  }

  async search(text: string): Promise<void> {
    await this.page.getByPlaceholder('Search by name or email...').fill(text)
    await this.page.waitForTimeout(400)
  }

  /** Number of submission rows currently shown (each has an "Evaluate" control). */
  async rowCount(): Promise<number> {
    return this.page.getByText('Evaluate', { exact: true }).count()
  }

  /** Whether a submission row for the given student email is visible (waited). */
  async hasStudent(email: string): Promise<boolean> {
    try {
      await this.page
        .getByText(email, { exact: false })
        .first()
        .waitFor({ state: 'visible', timeout: 5000 })
      return true
    } catch {
      return false
    }
  }

  /** Open the grading modal for the first (or only) submission row. */
  async evaluateFirst(): Promise<GradingModal> {
    await this.page.getByText('Evaluate', { exact: true }).first().click()
    const dialog = this.page.getByRole('dialog', { name: /Evaluate @/ })
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    return new GradingModal(this.page, dialog)
  }
}

/** Page object for the assignment EDITOR subpage (edit modal, publish, tasks). */
export class AssignmentEditorPage {
  constructor(private readonly page: Page) {}

  async open(bareAssignmentUuid: string): Promise<void> {
    await this.page.goto(
      `${BASE_URL}/dash/assignments/${bareAssignmentUuid}?subpage=editor`,
    )
    await expect(this.page.getByRole('button', { name: 'Add Task' })).toBeVisible({
      timeout: 20_000,
    })
  }

  /** Open the Edit modal, pick a grading type, and save. */
  async editGradingType(
    type: 'Alphabet' | 'Numeric' | 'Percentage' | 'Pass / Fail' | 'GPA Scale',
  ): Promise<void> {
    await this.page.getByText('Edit', { exact: true }).first().click()
    const dialog = this.page.getByRole('dialog', { name: 'Edit Assignment' })
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    await dialog.getByRole('button', { name: new RegExp(type.replace('/', '\\/')) }).first().click()
    await dialog.getByRole('button', { name: 'Save Changes' }).click()
    await expect(dialog).toBeHidden({ timeout: 10_000 })
  }

  async unpublish(): Promise<void> {
    await this.page.getByText('Unpublish', { exact: true }).click()
    await this.page.waitForTimeout(800)
  }

  async publish(): Promise<void> {
    await this.page.getByText('Publish', { exact: true }).click()
    await this.page.waitForTimeout(800)
  }

  /** Add a task of the given type via the "Add Task" modal. */
  async addTask(
    type: 'Quiz' | 'File submission' | 'Form' | 'Code' | 'Short answer' | 'Number answer',
  ): Promise<void> {
    await this.page.getByRole('button', { name: 'Add Task' }).click()
    const dialog = this.page.getByRole('dialog', { name: 'Add an Assignment Task' })
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    await dialog.getByRole('button', { name: new RegExp(`^${type}`) }).click()
    await this.page.waitForTimeout(800)
  }
}

export class GradingModal {
  constructor(private readonly page: Page, private readonly dialog: Locator) {}

  /** Apply the per-task "Grade" button and wait for the save to persist. */
  private async applyTaskGrade(): Promise<void> {
    // The per-task grade is PUT when "Grade" is clicked; wait for that request
    // so it persists BEFORE we finalize (otherwise finalize sums a stale grade).
    await Promise.all([
      this.page
        .waitForResponse(
          (r) => r.url().includes('/submissions') && ['PUT', 'POST'].includes(r.request().method()),
          { timeout: 10_000 },
        )
        .catch(() => null),
      this.dialog.getByText('Grade', { exact: true }).first().click(),
    ])
    await this.page.waitForLoadState('networkidle').catch(() => {})
    await this.page.waitForTimeout(400)
  }

  /** Set the first task's grade using the Full / Half / Zero shortcut, then apply. */
  async gradeFirstTask(level: 'Full' | 'Half' | 'Zero'): Promise<void> {
    await this.dialog.getByRole('button', { name: level }).first().click()
    await this.applyTaskGrade()
  }

  /** Set the first task's grade to a custom numeric value via the spinbutton, then apply. */
  async gradeFirstTaskNumeric(value: number): Promise<void> {
    await this.dialog.getByRole('spinbutton').first().fill(String(value))
    await this.applyTaskGrade()
  }

  async setOverallFeedback(text: string): Promise<void> {
    await this.dialog.getByRole('textbox', { name: /Write a comment/ }).fill(text)
  }

  async setFinalGrade(): Promise<void> {
    await this.dialog.getByRole('button', { name: 'Set final grade' }).click()
    await this.page.waitForLoadState('networkidle').catch(() => {})
    await this.page.waitForTimeout(600)
  }

  async finalizeAndComplete(): Promise<void> {
    await this.dialog.getByRole('button', { name: 'Finalize & Complete' }).click()
    await this.page.waitForLoadState('networkidle').catch(() => {})
    await this.page.waitForTimeout(800)
  }

  async reject(): Promise<void> {
    await this.dialog.getByRole('button', { name: 'Reject Assignment' }).click()
    // A confirmation dialog (titled "Dialog") appears with its own confirm button.
    const confirm = this.page
      .getByRole('dialog', { name: 'Dialog' })
      .getByRole('button', { name: 'Reject Assignment' })
    await confirm.click()
    await this.page.waitForTimeout(800)
  }
}
