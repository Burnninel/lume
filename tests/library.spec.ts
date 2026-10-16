import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

test.use({ viewport: { width: 1440, height: 1000 } })

async function openLibrary(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Modo leitura', exact: true })).toBeVisible()
  await expect(page.locator('.save-indicator')).toHaveText('Tudo salvo')
}

async function saved(page: Page) {
  await expect(page.locator('.save-indicator')).toHaveText('Tudo salvo')
  await expect(page.getByRole('alert')).toHaveCount(0)
}

async function createDocument(page: Page, name: string, markdown: string) {
  await page.getByRole('button', { name: 'Criar documento', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Uma nova página' })
  await dialog.getByLabel('Nome do documento').fill(name)
  await dialog.getByRole('button', { name: 'Criar', exact: true }).click()
  await page.getByRole('button', { name: 'Markdown', exact: true }).click()
  await page.getByRole('textbox', { name: 'Conteúdo Markdown' }).fill(markdown)
  await saved(page)
}

async function createFolder(page: Page, name: string) {
  await page.getByRole('button', { name: 'Nova pasta', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Organize suas ideias' })
  await dialog.getByLabel('Nome da pasta').fill(name)
  await dialog.getByRole('button', { name: 'Criar', exact: true }).click()
  await expect(page.locator('.folder-label').filter({ hasText: name })).toBeVisible()
}

test('documents and editor preferences survive reload and closing the tab', async ({ page, context }) => {
  await openLibrary(page)
  const markdown = '# Diário de pesquisa\n\nUma ideia com **acentuação** e conteúdo persistente.\n\n- [ ] Retomar amanhã\n'
  await createDocument(page, 'Diário de pesquisa', markdown)

  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Conteúdo Markdown' })).toHaveValue(markdown)
  await expect(page.locator('.document-file-label')).toContainText('Diário de pesquisa')
  await saved(page)

  await page.close()
  const reopened = await context.newPage()
  await openLibrary(reopened)
  await expect(reopened.getByRole('textbox', { name: 'Conteúdo Markdown' })).toHaveValue(markdown)
  await expect(reopened.locator('.document-list .document-item').filter({ hasText: 'Diário de pesquisa' })).toHaveCount(1)
})

test('imports a Markdown file, reads it safely and exports its original text', async ({ page }) => {
  await openLibrary(page)
  await page.getByRole('button', { name: 'Markdown', exact: true }).click()
  const markdown = '# Notas importadas\n\nTexto **importado** do computador.\n\n| Item | Estado |\n| --- | --- |\n| Anotações | Salvas |\n'
  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Arquivos .md', exact: true }).click()
  await (await chooserPromise).setFiles({ name: 'notas-importadas.md', mimeType: 'text/markdown', buffer: Buffer.from(markdown) })
  await expect(page.getByRole('textbox', { name: 'Conteúdo Markdown' })).toHaveValue(markdown)
  await saved(page)

  await page.getByRole('button', { name: 'Modo leitura', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Notas importadas', exact: true })).toBeVisible()
  await expect(page.locator('.reader table')).toContainText('Anotações')
  await expect(page.locator('[contenteditable="true"]')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Conteúdo Markdown' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Voltar à edição', exact: true }).click()

  await page.getByRole('button', { name: 'Exportar', exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Markdown (.md)', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('notas-importadas.md')
  expect(await readFile((await download.path())!, 'utf8')).toBe(markdown)

  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Conteúdo Markdown' })).toHaveValue(markdown)
})

test('organizes nested folders, blocks cycles and moves documents without losing text', async ({ page }) => {
  await openLibrary(page)
  await createFolder(page, 'Pesquisa')
  await createFolder(page, 'Fontes')
  await createDocument(page, 'Entrevista', '# Entrevista\n\nUma fonte importante.')
  await expect(page.locator('.breadcrumbs')).toContainText('Fontes')

  await page.getByRole('button', { name: 'Opções da pasta Pesquisa', exact: true }).click()
  await page.getByRole('button', { name: 'Mover para pasta', exact: true }).click()
  const folderDialog = page.getByRole('dialog', { name: 'Mover pasta' })
  await expect(folderDialog.getByRole('option', { name: 'Pesquisa', exact: true })).toHaveCount(0)
  await expect(folderDialog.getByRole('option', { name: 'Fontes', exact: true })).toHaveCount(0)
  await folderDialog.getByRole('button', { name: 'Cancelar', exact: true }).click()

  await page.getByRole('button', { name: 'Mais opções do documento', exact: true }).click()
  await page.getByRole('button', { name: 'Mover para pasta', exact: true }).click()
  const documentDialog = page.getByRole('dialog', { name: 'Mover documento' })
  await documentDialog.getByLabel('Pasta de destino').selectOption({ label: 'Projetos' })
  await documentDialog.getByRole('button', { name: 'Mover', exact: true }).click()
  await expect(page.locator('.breadcrumbs')).toContainText('Projetos')
  await page.locator('.folder-label').filter({ hasText: 'Projetos' }).click()
  await expect(page.locator('.document-list .document-item').filter({ hasText: 'Entrevista' })).toHaveCount(1)
  await saved(page)
  await page.reload()
  await expect(page.locator('.breadcrumbs')).toContainText('Projetos')
  await expect(page.getByRole('textbox', { name: 'Conteúdo Markdown' })).toHaveValue('# Entrevista\n\nUma fonte importante.')
})

test('favorites and trash persist, and restoring a document retains its content', async ({ page }) => {
  await openLibrary(page)
  const markdown = '# Ideia favorita\n\nNão perder este pensamento.'
  await createDocument(page, 'Ideia favorita', markdown)
  await page.getByRole('button', { name: 'Adicionar aos favoritos', exact: true }).click()
  await page.getByRole('navigation', { name: 'Biblioteca' }).getByRole('button', { name: /^Favoritos/ }).click()
  await expect(page.locator('.document-list .document-item').filter({ hasText: 'Ideia favorita' })).toHaveCount(1)

  await page.getByRole('button', { name: 'Mais opções do documento', exact: true }).click()
  await page.getByRole('button', { name: 'Mover para a lixeira', exact: true }).click()
  await expect(page.getByText('Este documento está na lixeira.', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Lixeira', exact: true }).click()
  await expect(page.locator('.document-list .document-item').filter({ hasText: 'Ideia favorita' })).toHaveCount(1)
  await saved(page)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Restaurar documento', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Ideia favorita', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Restaurar documento', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Conteúdo Markdown' })).toHaveValue(markdown)
  await expect(page.getByRole('button', { name: 'Remover dos favoritos', exact: true })).toBeVisible()
  await saved(page)
})

test('exports a complete backup and imports it without overwriting existing documents', async ({ page }) => {
  await openLibrary(page)
  await createDocument(page, 'Documento protegido', '# Backup\n\nConteúdo que deve voltar.')
  await page.getByRole('button', { name: 'Adicionar aos favoritos', exact: true }).click()
  await saved(page)
  const before = await page.locator('.document-list .document-item').count()
  await page.getByRole('button', { name: 'Preferências', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Do seu jeito' })
  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Baixar backup', exact: true }).click()
  const download = await downloadPromise
  const backupText = await readFile((await download.path())!, 'utf8')
  const backup = JSON.parse(backupText)
  expect(backup.format).toBe('lume-backup')
  expect(backup.version).toBe(1)
  expect(backup.library.documents.find((document: { name: string }) => document.name === 'Documento protegido')).toMatchObject({ content: '# Backup\n\nConteúdo que deve voltar.', favorite: true })
  expect(backup.library.folders.map((folder: { name: string }) => folder.name)).toEqual(expect.arrayContaining(['Pessoal', 'Projetos', 'Referências']))

  const chooserPromise = page.waitForEvent('filechooser')
  await dialog.getByRole('button', { name: 'Importar backup', exact: true }).click()
  await (await chooserPromise).setFiles({ name: 'lume-backup.json', mimeType: 'application/json', buffer: Buffer.from(backupText) })
  await expect(page.getByRole('status')).toContainText('Backup importado')
  await dialog.getByRole('button', { name: 'Fechar diálogo', exact: true }).click()
  await expect(page.locator('.document-list .document-item')).toHaveCount(before * 2)
  await expect(page.locator('.document-list .document-item').filter({ hasText: 'Documento protegido' })).toHaveCount(2)
  await saved(page)
  await page.reload()
  await expect(page.locator('.document-list .document-item').filter({ hasText: 'Documento protegido' })).toHaveCount(2)
})

test('rejects malformed backups without changing the library', async ({ page }) => {
  await openLibrary(page)
  const before = await page.locator('.document-list .document-item').count()
  await page.getByRole('button', { name: 'Preferências', exact: true }).click()
  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('dialog').getByRole('button', { name: 'Importar backup', exact: true }).click()
  await (await chooserPromise).setFiles({ name: 'invalido.json', mimeType: 'application/json', buffer: Buffer.from('{ "format": "lume-backup", "version": 999 }') })
  await expect(page.getByRole('status')).toContainText('versão')
  await page.getByRole('button', { name: 'Fechar diálogo', exact: true }).click()
  await expect(page.locator('.document-list .document-item')).toHaveCount(before)
  await saved(page)
})

test('a second tab is read only until the writing tab closes', async ({ page, context }) => {
  await openLibrary(page)
  await createDocument(page, 'Uma aba por vez', '# Protegido\n\nTexto da primeira aba.')
  const second = await context.newPage()
  await second.goto('/')
  await expect(second.locator('.warning-banner')).toContainText('aberta em outra aba')
  await expect(second.getByRole('heading', { name: 'Protegido', exact: true })).toBeVisible()
  await expect(second.getByRole('textbox', { name: 'Conteúdo Markdown' })).toHaveCount(0)
  await expect(second.getByRole('button', { name: 'Negrito', exact: true })).toBeDisabled()

  await page.close()
  await second.getByRole('button', { name: 'recarregue', exact: true }).click()
  await expect(second.locator('.warning-banner')).toHaveCount(0)
  await expect(second.getByRole('textbox', { name: 'Conteúdo Markdown' })).toHaveValue('# Protegido\n\nTexto da primeira aba.')
  await second.getByRole('textbox', { name: 'Conteúdo Markdown' }).fill('# Protegido\n\nAgora editado pela segunda aba.')
  await saved(second)
  await second.reload()
  await expect(second.getByRole('textbox', { name: 'Conteúdo Markdown' })).toHaveValue('# Protegido\n\nAgora editado pela segunda aba.')
})
