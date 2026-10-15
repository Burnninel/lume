import { expect, test } from '@playwright/test'

test('production build works under a repository path and after going offline', async ({ page, context }) => {
  test.skip(!process.env.LUME_PRODUCTION_TEST, 'Run against the built site: LUME_PRODUCTION_TEST=1')
  await page.goto('http://127.0.0.1:4175/lume/')
  await expect(page.getByRole('textbox', { name: 'Conteúdo do documento' })).toBeVisible()
  await page.getByRole('button', { name: 'Markdown', exact: true }).click()
  await page.getByRole('textbox', { name: 'Conteúdo Markdown' }).fill('# Trabalho offline\n\nMeu texto continua aqui.')
  await expect(page.locator('.save-indicator')).toHaveText('Tudo salvo')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }))
  })
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Conteúdo Markdown' })).toHaveValue('# Trabalho offline\n\nMeu texto continua aqui.')
  await page.getByRole('button', { name: 'Escrever', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Conteúdo do documento' })).toBeVisible()
  await page.getByRole('button', { name: 'Modo leitura', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Trabalho offline', exact: true })).toBeVisible()
})
