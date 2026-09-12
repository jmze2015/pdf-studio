import { useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { PDFDocument } from 'pdf-lib'

import {
  DndContext,
  closestCenter,
  useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core'

import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'

import { CSS } from '@dnd-kit/utilities'

declare global {
  interface Window {
    showSaveFilePicker?: (options?: {
      suggestedName?: string
      types?: {
        description?: string
        accept: Record<string, string[]>
      }[]
    }) => Promise<FileSystemFileHandle>
  }
}

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

type PdfPage = {
  id: string
  sourcePdfId: string
  originalPageIndex: number
  thumbnail: string
}

type PdfFileItem = {
  id: string
  file: File
  expanded: boolean
  pages: PdfPage[]
}

type SortablePageProps = {
  page: PdfPage
  onDelete: (pageId: string) => void
}

function SortablePage({
  page,
  onDelete,
}: SortablePageProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: page.id,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="page-card"
    >
      <button
        className="page-delete-button"
        type="button"
        title="Remove page"
        aria-label={`Remove page ${page.originalPageIndex + 1}`}
        onPointerDown={(event) => {
          event.stopPropagation()
        }}
        onClick={(event) => {
          event.stopPropagation()
          onDelete(page.id)
        }}
      >
        ×
      </button>

      <div
        ref={setActivatorNodeRef}
        className="page-drag-surface"
        {...attributes}
        {...listeners}
      >
        <img
          src={page.thumbnail}
          alt={`Page ${page.originalPageIndex + 1}`}
          draggable={false}
        />

        <span>
          Page {page.originalPageIndex + 1}
        </span>
      </div>
    </div>
  )
}

type PdfPageAreaProps = {
  pdf: PdfFileItem
  onDelete: (pageId: string) => void
}

function PdfPageArea({
  pdf,
  onDelete,
}: PdfPageAreaProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `container-${pdf.id}`,
  })

  return (
    <SortableContext
      items={pdf.pages.map((page) => page.id)}
      strategy={rectSortingStrategy}
    >
      <div
        ref={setNodeRef}
        className={
          isOver
            ? 'thumbnail-grid thumbnail-grid-over'
            : 'thumbnail-grid'
        }
      >
        {pdf.pages.map((page) => (
          <SortablePage
            key={page.id}
            page={page}
            onDelete={onDelete}
          />
        ))}

        {pdf.pages.length === 0 && (
          <div className="empty-pdf">
            Drop pages here
          </div>
        )}
      </div>
    </SortableContext>
  )
}

export default function App() {
  const [pdfFiles, setPdfFiles] = useState<PdfFileItem[]>([])
  const [isExporting, setIsExporting] = useState(false)

  const handleFiles = async (files: FileList | null) => {
    if (!files) return

    const incoming = Array.from(files).filter(
      (file) => file.type === 'application/pdf',
    )

    const loadedFiles: PdfFileItem[] = []

    for (const file of incoming) {
      const pdfId = crypto.randomUUID()

      const arrayBuffer = await file.arrayBuffer()

      const pdf = await pdfjsLib.getDocument({
        data: arrayBuffer,
      }).promise

      const pages: PdfPage[] = []

      for (
        let pageNumber = 1;
        pageNumber <= pdf.numPages;
        pageNumber++
      ) {
        const page = await pdf.getPage(pageNumber)

        const viewport = page.getViewport({
          scale: 0.25,
        })

        const canvas = document.createElement('canvas')
        const context = canvas.getContext('2d')

        if (!context) continue

        canvas.width = viewport.width
        canvas.height = viewport.height

        await page.render({
          canvas,
          canvasContext: context,
          viewport,
        }).promise

        pages.push({
          id: crypto.randomUUID(),
          sourcePdfId: pdfId,
          originalPageIndex: pageNumber - 1,
          thumbnail: canvas.toDataURL('image/png'),
        })
      }

      loadedFiles.push({
        id: pdfId,
        file,
        expanded: true,
        pages,
      })
    }

    setPdfFiles((current) => [
      ...current,
      ...loadedFiles,
    ])
  }

  const toggleExpanded = (id: string) => {
    setPdfFiles((current) =>
      current.map((pdf) =>
        pdf.id === id
          ? {
              ...pdf,
              expanded: !pdf.expanded,
            }
          : pdf,
      ),
    )
  }

  const findContainerForPage = (
    files: PdfFileItem[],
    pageId: string,
  ) => {
    return files.find((pdf) =>
      pdf.pages.some((page) => page.id === pageId),
    )
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    if (!over) return

    setPdfFiles((current) => {
      const activeContainer = findContainerForPage(
        current,
        String(active.id),
      )

      if (!activeContainer) {
        return current
      }

      let overContainer: PdfFileItem | undefined
      let targetIndex = 0

      const overId = String(over.id)

      if (overId.startsWith('container-')) {
        const containerId = overId.replace(
          'container-',
          '',
        )

        overContainer = current.find(
          (pdf) => pdf.id === containerId,
        )

        if (overContainer) {
          targetIndex = overContainer.pages.length
        }
      } else {
        overContainer = findContainerForPage(
          current,
          overId,
        )

        if (overContainer) {
          targetIndex = overContainer.pages.findIndex(
            (page) => page.id === overId,
          )
        }
      }

      if (!overContainer) {
        return current
      }

      const oldIndex =
        activeContainer.pages.findIndex(
          (page) => page.id === active.id,
        )

      if (oldIndex === -1) {
        return current
      }

      if (activeContainer.id === overContainer.id) {
        if (overId.startsWith('container-')) {
          targetIndex =
            activeContainer.pages.length - 1
        }

        if (oldIndex === targetIndex) {
          return current
        }

        return current.map((pdf) =>
          pdf.id === activeContainer.id
            ? {
                ...pdf,
                pages: arrayMove(
                  pdf.pages,
                  oldIndex,
                  targetIndex,
                ),
              }
            : pdf,
        )
      }

      const movingPage =
        activeContainer.pages[oldIndex]

      return current.map((pdf) => {
        if (pdf.id === activeContainer.id) {
          return {
            ...pdf,
            pages: pdf.pages.filter(
              (page) =>
                page.id !== movingPage.id,
            ),
          }
        }

        if (pdf.id === overContainer.id) {
          const nextPages = [...pdf.pages]

          nextPages.splice(
            targetIndex,
            0,
            movingPage,
          )

          return {
            ...pdf,
            pages: nextPages,
          }
        }

        return pdf
      })
    })
  }

  const deletePage = (pageId: string) => {
    setPdfFiles((current) =>
      current.map((pdf) => ({
        ...pdf,
        pages: pdf.pages.filter(
          (page) => page.id !== pageId,
        ),
      })),
    )
  }

  const totalPages = pdfFiles.reduce(
    (total, pdf) => total + pdf.pages.length,
    0,
  )

  const exportCombinedPdf = async () => {
    if (totalPages === 0 || isExporting) {
      return
    }

    try {
      setIsExporting(true)

      const outputPdf = await PDFDocument.create()

      const sourceDocuments =
        new Map<string, PDFDocument>()

      for (const pdf of pdfFiles) {
        const bytes = await pdf.file.arrayBuffer()

        const sourceDocument =
          await PDFDocument.load(bytes)

        sourceDocuments.set(
          pdf.id,
          sourceDocument,
        )
      }

      for (const pdf of pdfFiles) {
        for (const page of pdf.pages) {
          const sourceDocument =
            sourceDocuments.get(
              page.sourcePdfId,
            )

          if (!sourceDocument) {
            continue
          }

          const [copiedPage] =
            await outputPdf.copyPages(
              sourceDocument,
              [page.originalPageIndex],
            )

          outputPdf.addPage(copiedPage)
        }
      }

      const outputBytes =
        await outputPdf.save()

      const blob = new Blob(
  [outputBytes as BlobPart],
  {
    type: 'application/pdf',
  },
)

if (window.showSaveFilePicker) {
  const fileHandle = await window.showSaveFilePicker({
    suggestedName: 'combined.pdf',
    types: [
      {
        description: 'PDF Document',
        accept: {
          'application/pdf': ['.pdf'],
        },
      },
    ],
  })

  const writable =
    await fileHandle.createWritable()

  await writable.write(blob)
  await writable.close()
} else {
  const url =
    URL.createObjectURL(blob)

  const link =
    document.createElement('a')

  link.href = url
  link.download = 'combined.pdf'
  link.click()

  URL.revokeObjectURL(url)
}
      
    } catch (error) {
      console.error(
        'Failed to export PDF:',
        error,
      )

      alert(
        'Something went wrong while exporting the PDF.',
      )
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <h1>PDF Studio</h1>

          <p>
            Organize and combine PDFs directly in your browser.
          </p>
        </div>

        <div className="header-actions">
          <label className="add-button">
            Add PDFs

            <input
              type="file"
              accept="application/pdf"
              multiple
              onChange={(event) =>
                handleFiles(
                  event.target.files,
                )
              }
              hidden
            />
          </label>

          <button
            type="button"
            className="export-button"
            disabled={
              totalPages === 0 ||
              isExporting
            }
            onClick={exportCombinedPdf}
          >
            {isExporting
              ? 'Exporting...'
              : `Export PDF (${totalPages})`}
          </button>
        </div>
      </header>

      <section
        className="drop-zone"
        onDragOver={(event) =>
          event.preventDefault()
        }
        onDrop={(event) => {
          event.preventDefault()
          handleFiles(
            event.dataTransfer.files,
          )
        }}
      >
        <strong>Drop PDFs here</strong>

        <span>
          or click “Add PDFs”
        </span>
      </section>

      <DndContext
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <section className="file-list">
          {pdfFiles.map((pdf) => (
            <article
              key={pdf.id}
              className="pdf-card"
            >
              <button
                className="pdf-header"
                onClick={() =>
                  toggleExpanded(pdf.id)
                }
              >
                <span>
                  {pdf.expanded
                    ? '▼'
                    : '▶'}
                </span>

                <span className="file-name">
                  {pdf.file.name}
                </span>

                <span className="page-count">
                  {pdf.pages.length}{' '}
                  {pdf.pages.length === 1
                    ? 'page'
                    : 'pages'}
                </span>
              </button>

              {pdf.expanded && (
                <PdfPageArea
                  pdf={pdf}
                  onDelete={deletePage}
                />
              )}
            </article>
          ))}

          {pdfFiles.length === 0 && (
            <div className="empty-state">
              No PDFs loaded yet.
            </div>
          )}
        </section>
      </DndContext>
    </main>
  )
}