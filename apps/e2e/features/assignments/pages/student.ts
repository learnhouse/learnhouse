/**
 * Page object for the student-facing assignment activity view.
 *
 * Drives the assignment exactly like a learner: answer each task, save
 * progress, submit for grading, and read the resulting grade. All selectors
 * come from the running (published-image) UI and were verified live:
 *   - Quiz option rows render the option letter as text ("A", "B", …).
 *   - Short answer  -> input placeholder "Type your answer..."
 *   - Number answer -> input placeholder "Enter a number..."
 *   - Form blank    -> the assignment's only <input> without a placeholder.
 *   - "Save your progress" / "Submit for grading" are clickable text.
 *   - Confirm dialog has a "Submit Assignment" button.
 *   - Result modal shows "<n>/100" and a "Graded <n>/100" status chip.
 */
import { Page, Locator, expect } from '@playwright/test'
import { BASE_URL } from '../../../core/instance'

export class AssignmentPage {
  constructor(private readonly page: Page) {}

  /** Open the student activity view. Pass bare UUIDs (no course_/activity_ prefix). */
  async open(bareCourseUuid: string, bareActivityUuid: string): Promise<void> {
    await this.page.goto(`${BASE_URL}/course/${bareCourseUuid}/activity/${bareActivityUuid}`)
    await expect(this.page.getByText('Assignment', { exact: true }).first()).toBeVisible({
      timeout: 20_000,
    })
  }

  /** The assignment body (excludes the top nav, which has its own search input). */
  private body(): Locator {
    return this.page.locator('main')
  }

  /** Select a quiz option by its visible letter (e.g. "A"). */
  async answerQuiz(optionLetter: string): Promise<void> {
    await this.body().getByText(optionLetter, { exact: true }).first().click()
    // Let the component commit the toggled selection before a save reads state.
    await this.page.waitForTimeout(300)
  }

  /** Type into a short-answer task. */
  async answerShort(text: string): Promise<void> {
    await this.page.getByPlaceholder('Type your answer...').first().fill(text)
  }

  /** Type into a number-answer task. */
  async answerNumber(value: string): Promise<void> {
    await this.page.getByPlaceholder('Enter a number...').first().fill(value)
  }

  /** Fill a form-task blank (the only assignment input without a placeholder). */
  async answerForm(text: string, index = 0): Promise<void> {
    await this.body().locator('input:not([placeholder])').nth(index).fill(text)
  }

  /**
   * Upload a file for a FILE_SUBMISSION task. The "Submit File" button opens a
   * native file chooser; we satisfy it via Playwright's filechooser event
   * (mirrors the real user gesture — the component uploads on selection).
   */
  async uploadFile(filePath: string): Promise<void> {
    const [chooser] = await Promise.all([
      this.page.waitForEvent('filechooser'),
      this.body().getByRole('button', { name: 'Submit File' }).click(),
    ])
    await chooser.setFiles(filePath)
    await this.page.waitForLoadState('networkidle').catch(() => {})
    await this.page.waitForTimeout(2000)
  }

  /**
   * Save progress. Each task has its own "Save your progress" control, so we
   * click every one of them (an assignment with N tasks renders N buttons).
   */
  async saveProgress(): Promise<void> {
    // The page can render responsive duplicates (some hidden), so click only
    // the visible "Save your progress" controls — one per task. Each click
    // PUTs the task submission; we settle the network after each so every
    // answer is persisted before we submit (otherwise a task can grade as
    // unanswered).
    const buttons = this.body().getByText('Save your progress')
    const count = await buttons.count()
    for (let i = 0; i < count; i++) {
      const btn = buttons.nth(i)
      if (!(await btn.isVisible().catch(() => false))) continue
      // Wait for the task-submission PUT so the answer is persisted before we
      // move on (a save that races ahead of persistence grades as unanswered).
      await Promise.all([
        this.page
          .waitForResponse(
            (r) => r.url().includes('/submissions') && r.request().method() === 'PUT',
            { timeout: 8000 },
          )
          .catch(() => null),
        btn.click(),
      ])
      await this.page.waitForLoadState('networkidle').catch(() => {})
      await this.page.waitForTimeout(200)
    }
  }

  /** Submit the whole assignment and confirm the dialog. */
  async submitForGrading(): Promise<void> {
    const submit = this.body().getByText('Submit for grading')
    const count = await submit.count()
    for (let i = 0; i < count; i++) {
      const btn = submit.nth(i)
      if (await btn.isVisible().catch(() => false)) {
        await btn.click()
        break
      }
    }
    const confirm = this.page.getByRole('button', { name: 'Submit Assignment' })
    await expect(confirm).toBeVisible({ timeout: 10_000 })
    await confirm.click()
    // Wait for the submit to round-trip and the confirm dialog to close.
    await expect(confirm).toBeHidden({ timeout: 15_000 })
    await this.page.waitForLoadState('networkidle').catch(() => {})
  }

  /**
   * Wait for the auto-grade result and assert the displayed score.
   * Returns the parsed numeric grade (out of 100).
   */
  async expectGraded(expectedGrade?: number): Promise<number> {
    // After submit the status chip flips to "Graded" and a result modal shows
    // the score as "<n>/100". Wait for the graded state, then parse the score.
    await expect(this.page.getByText('Graded', { exact: false }).first()).toBeVisible({
      timeout: 20_000,
    })
    const score = this.page.getByText(/\b\d+\/100\b/).first()
    await expect(score).toBeVisible({ timeout: 20_000 })
    const text = (await score.textContent()) || ''
    const m = text.match(/(\d+)\/100/)
    const grade = m ? parseInt(m[1], 10) : NaN
    if (expectedGrade !== undefined) {
      expect(grade).toBe(expectedGrade)
    }
    return grade
  }

  /**
   * Retry a graded assignment: click the result modal's "Try again", then
   * confirm in the follow-up dialog. Leaves the assignment re-answerable.
   */
  async retry(): Promise<void> {
    await this.page.getByRole('button', { name: 'Try again' }).first().click()
    const confirm = this.page
      .getByRole('dialog', { name: 'Dialog' })
      .getByRole('button', { name: 'Try again' })
    await confirm.click()
    await this.page.waitForTimeout(1500)
  }

  /** Wait until the submission is graded (status chip flips to "Graded …").
   * Use for non-numeric grading types where the score isn't shown as "n/100". */
  async waitGraded(): Promise<void> {
    await expect(this.page.getByText('Graded', { exact: false }).first()).toBeVisible({
      timeout: 20_000,
    })
  }

  /** Close the celebratory result modal if it is open. */
  async dismissResultModal(): Promise<void> {
    const close = this.page.getByRole('button', { name: 'Close' }).first()
    if (await close.isVisible().catch(() => false)) {
      await close.click().catch(() => {})
    }
  }
}
