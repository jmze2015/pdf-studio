import {
  useEffect,
  useRef,
  useState,
} from 'react'

import * as pdfjsLib from 'pdfjs-dist'

import pdfWorker from
  'pdfjs-dist/build/pdf.worker.min.mjs?url'

import {
  PDFDocument,
  StandardFonts,
  rgb,
} from 'pdf-lib'

pdfjsLib.GlobalWorkerOptions.workerSrc =
  pdfWorker

declare global {
  interface Window {
    showSaveFilePicker?: (
      options?: {
        suggestedName?: string
        types?: {
          description?: string
          accept: Record<
            string,
            string[]
          >
        }[]
      },
    ) => Promise<FileSystemFileHandle>
  }
}

type PdfDocument = Awaited<
  ReturnType<
    typeof pdfjsLib.getDocument
  >['promise']
>

type TextRegion = {
  id: string
  pageNumber: number
  text: string

  /*
   * Coordinates used by the browser preview.
   */
  x: number
  y: number
  width: number
  height: number
  fontSize: number

  /*
   * Original PDF coordinates.
   * These are used when exporting.
   */
  pdfX: number
  pdfY: number
  pdfWidth: number
  pdfHeight: number
  pdfFontSize: number
}

type PageThumbnail = {
  pageNumber: number
  imageUrl: string
}

type TextEdit = {
  regionId: string
  pageNumber: number
  originalText: string
  replacementText: string

  x: number
  y: number
  width: number
  height: number
  fontSize: number

  pdfX: number
  pdfY: number
  pdfWidth: number
  pdfHeight: number
  pdfFontSize: number
}

export default function EditPage() {
  const [file, setFile] =
    useState<File | null>(null)

  const [pdfDocument, setPdfDocument] =
    useState<PdfDocument | null>(null)

  const [selectedPage, setSelectedPage] =
    useState(1)

  const [thumbnails, setThumbnails] =
    useState<PageThumbnail[]>([])

  const [textRegions, setTextRegions] =
    useState<TextRegion[]>([])

  const [showTextRegions, setShowTextRegions] =
    useState(true)

  const [isLoading, setIsLoading] =
    useState(false)

  const [isSaving, setIsSaving] =
    useState(false)

  const [pageWidth, setPageWidth] =
    useState(0)

  const [pageHeight, setPageHeight] =
    useState(0)

  const [edits, setEdits] =
    useState<TextEdit[]>([])

  const [selectedRegion, setSelectedRegion] =
    useState<TextRegion | null>(null)

  const [editValue, setEditValue] =
    useState('')

  const canvasRef =
    useRef<HTMLCanvasElement | null>(
      null,
    )

  /*
   * Keep this identical to the scale used
   * when rendering the large editor page.
   */
  const editorScale = 1.35

  const handleOpenPdf = async (
    selectedFile: File | null,
  ) => {
    if (!selectedFile) return

    setIsLoading(true)

    try {
      const bytes =
        await selectedFile.arrayBuffer()

      const pdf =
        await pdfjsLib.getDocument({
          data: bytes,
        }).promise

      setFile(selectedFile)
      setPdfDocument(pdf)

      setSelectedPage(1)
      setTextRegions([])
      setEdits([])
      setSelectedRegion(null)
      setEditValue('')

      await createThumbnails(pdf)
    } catch (error) {
      console.error(
        'Unable to open PDF:',
        error,
      )

      alert(
        'PDF Studio could not open this PDF.',
      )
    } finally {
      setIsLoading(false)
    }
  }

  const createThumbnails = async (
    pdf: PdfDocument,
  ) => {
    const newThumbnails:
      PageThumbnail[] = []

    for (
      let pageNumber = 1;
      pageNumber <= pdf.numPages;
      pageNumber++
    ) {
      const page =
        await pdf.getPage(pageNumber)

      const viewport =
        page.getViewport({
          scale: 0.22,
        })

      const canvas =
        document.createElement(
          'canvas',
        )

      const context =
        canvas.getContext('2d')

      if (!context) continue

      canvas.width =
        Math.ceil(viewport.width)

      canvas.height =
        Math.ceil(viewport.height)

      await page.render({
        canvas,
        canvasContext: context,
        viewport,
      }).promise

      newThumbnails.push({
        pageNumber,
        imageUrl:
          canvas.toDataURL(
            'image/png',
          ),
      })
    }

    setThumbnails(
      newThumbnails,
    )
  }

  useEffect(() => {
    if (!pdfDocument) return

    let cancelled = false

    const renderSelectedPage =
      async () => {
        const page =
          await pdfDocument.getPage(
            selectedPage,
          )

        const viewport =
          page.getViewport({
            scale: editorScale,
          })

        const canvas =
          canvasRef.current

        if (!canvas) return

        const context =
          canvas.getContext('2d')

        if (!context) return

        canvas.width =
          Math.ceil(
            viewport.width,
          )

        canvas.height =
          Math.ceil(
            viewport.height,
          )

        setPageWidth(
          Math.ceil(
            viewport.width,
          ),
        )

        setPageHeight(
          Math.ceil(
            viewport.height,
          ),
        )

        await page.render({
          canvas,
          canvasContext: context,
          viewport,
        }).promise

        const textContent =
          await page.getTextContent()

        const regions:
          TextRegion[] = []

        textContent.items.forEach(
          (item, index) => {
            if (!('str' in item)) {
              return
            }

            if (!item.str.trim()) {
              return
            }

            /*
             * Browser coordinates.
             */
            const transform =
              pdfjsLib.Util.transform(
                viewport.transform,
                item.transform,
              )

            const x =
              transform[4]

            const fontSize =
              Math.sqrt(
                transform[2] *
                  transform[2] +
                  transform[3] *
                    transform[3],
              )

            const height =
              Math.max(
                fontSize,
                4,
              )

            const y =
              transform[5] -
              height

            const width =
              Math.max(
                item.width *
                  editorScale,
                2,
              )

            /*
             * Original PDF coordinates.
             *
             * item.transform[4] and [5]
             * give us the text origin in
             * PDF-space coordinates.
             */
            const pdfX =
              item.transform[4]

            const pdfY =
              item.transform[5]

            const pdfFontSize =
              Math.sqrt(
                item.transform[2] *
                  item.transform[2] +
                  item.transform[3] *
                    item.transform[3],
              )

            const pdfHeight =
              Math.max(
                pdfFontSize,
                1,
              )

            const pdfWidth =
              Math.max(
                item.width,
                1,
              )

            regions.push({
              id:
                `${selectedPage}-${index}`,

              pageNumber:
                selectedPage,

              text: item.str,

              x,
              y,
              width,
              height,
              fontSize,

              pdfX,
              pdfY,
              pdfWidth,
              pdfHeight,
              pdfFontSize,
            })
          },
        )

        if (!cancelled) {
          setTextRegions(
            regions,
          )
        }
      }

    renderSelectedPage()

    return () => {
      cancelled = true
    }
  }, [
    pdfDocument,
    selectedPage,
  ])

  const findEdit = (
    regionId: string,
  ) => {
    return edits.find(
      (edit) =>
        edit.regionId ===
        regionId,
    )
  }

  const openTextEditor = (
    region: TextRegion,
  ) => {
    const existingEdit =
      findEdit(region.id)

    setSelectedRegion(
      region,
    )

    setEditValue(
      existingEdit
        ? existingEdit.replacementText
        : region.text,
    )
  }

  const cancelTextEdit = () => {
    setSelectedRegion(null)
    setEditValue('')
  }

  const applyTextEdit = () => {
    if (!selectedRegion) {
      return
    }

    const replacement =
      editValue

    const newEdit: TextEdit = {
      regionId:
        selectedRegion.id,

      pageNumber:
        selectedRegion.pageNumber,

      originalText:
        selectedRegion.text,

      replacementText:
        replacement,

      x: selectedRegion.x,
      y: selectedRegion.y,
      width:
        selectedRegion.width,
      height:
        selectedRegion.height,
      fontSize:
        selectedRegion.fontSize,

      pdfX:
        selectedRegion.pdfX,
      pdfY:
        selectedRegion.pdfY,
      pdfWidth:
        selectedRegion.pdfWidth,
      pdfHeight:
        selectedRegion.pdfHeight,
      pdfFontSize:
        selectedRegion.pdfFontSize,
    }

    setEdits(
      (current) => {
        const withoutOld =
          current.filter(
            (edit) =>
              edit.regionId !==
              newEdit.regionId,
          )

        /*
         * If the user changes the text
         * back to exactly what it was,
         * remove the edit.
         */
        if (
          replacement ===
          selectedRegion.text
        ) {
          return withoutOld
        }

        return [
          ...withoutOld,
          newEdit,
        ]
      },
    )

    setSelectedRegion(null)
    setEditValue('')
  }

  const removeEdit = (
    regionId: string,
  ) => {
    setEdits(
      (current) =>
        current.filter(
          (edit) =>
            edit.regionId !==
            regionId,
        ),
    )

    setSelectedRegion(null)
    setEditValue('')
  }

  const savePdf = async () => {
    if (
      !file ||
      edits.length === 0 ||
      isSaving
    ) {
      return
    }

    setIsSaving(true)

    try {
      const sourceBytes =
        await file.arrayBuffer()

      const outputPdf =
        await PDFDocument.load(
          sourceBytes,
        )

      /*
       * Helvetica is our first-pass
       * replacement font.
       *
       * Later we'll improve this by
       * matching the source font.
       */
      const replacementFont =
        await outputPdf.embedFont(
          StandardFonts.Helvetica,
        )

      for (
        let pageIndex = 0;
        pageIndex <
        outputPdf.getPageCount();
        pageIndex++
      ) {
        const pageNumber =
          pageIndex + 1

        const page =
          outputPdf.getPage(
            pageIndex,
          )

        const pageEdits =
          edits.filter(
            (edit) =>
              edit.pageNumber ===
              pageNumber,
          )

        for (
          const edit
          of pageEdits
        ) {
          /*
           * Cover the old text.
           *
           * The extra padding helps
           * hide antialiased edges.
           */
          const padding = 1.5

          page.drawRectangle({
            x:
              edit.pdfX -
              padding,

            y:
              edit.pdfY -
              padding,

            width:
              edit.pdfWidth +
              padding * 2,

            height:
              edit.pdfHeight +
              padding * 2,

            color: rgb(
              1,
              1,
              1,
            ),
          })

          /*
           * Draw the replacement.
           *
           * PDF text coordinates use
           * the baseline, so pdfY is
           * appropriate here.
           */
          if (
            edit.replacementText
              .length > 0
          ) {
            page.drawText(
              edit.replacementText,
              {
                x:
                  edit.pdfX,

                y:
                  edit.pdfY,

                size:
                  Math.max(
                    edit.pdfFontSize,
                    1,
                  ),

                font:
                  replacementFont,

                color: rgb(
                  0,
                  0,
                  0,
                ),
              },
            )
          }
        }
      }

      const outputBytes =
        await outputPdf.save()

      const blob =
        new Blob(
          [
            outputBytes as
              BlobPart,
          ],
          {
            type:
              'application/pdf',
          },
        )

      const originalName =
        file.name.replace(
          /\.pdf$/i,
          '',
        )

      const suggestedName =
        `${originalName}-edited.pdf`

      if (
        window.showSaveFilePicker
      ) {
        const fileHandle =
          await window.showSaveFilePicker(
            {
              suggestedName,

              types: [
                {
                  description:
                    'PDF Document',

                  accept: {
                    'application/pdf':
                      ['.pdf'],
                  },
                },
              ],
            },
          )

        const writable =
          await fileHandle.createWritable()

        await writable.write(
          blob,
        )

        await writable.close()
      } else {
        const url =
          URL.createObjectURL(
            blob,
          )

        const link =
          document.createElement(
            'a',
          )

        link.href = url

        link.download =
          suggestedName

        link.click()

        URL.revokeObjectURL(
          url,
        )
      }
    } catch (error) {
      /*
       * Closing the Save As dialog
       * also lands here in some
       * browsers, which is harmless.
       */
      console.error(
        'Unable to save PDF:',
        error,
      )
    } finally {
      setIsSaving(false)
    }
  }

  if (!pdfDocument) {
    return (
      <section className="edit-page">
        <div className="edit-empty-state">
          <h2>
            Edit PDF
          </h2>

          <p>
            Open a PDF to edit
            its existing text.
          </p>

          <label className="add-button">
            {isLoading
              ? 'Opening...'
              : 'Open PDF'}

            <input
              type="file"
              accept="application/pdf"
              disabled={
                isLoading
              }
              hidden
              onChange={(
                event,
              ) =>
                handleOpenPdf(
                  event
                    .target
                    .files?.[0] ??
                    null,
                )
              }
            />
          </label>
        </div>
      </section>
    )
  }

  const currentPageEdits =
    edits.filter(
      (edit) =>
        edit.pageNumber ===
        selectedPage,
    )

  return (
    <section className="edit-page">
      <header className="editor-header">
        <div>
          <h2>
            Edit PDF
          </h2>

          <p>
            {file?.name}
          </p>
        </div>

        <div className="editor-actions">
          <span className="edit-counter">
            {edits.length}{' '}
            {edits.length === 1
              ? 'edit'
              : 'edits'}
          </span>

          <button
            type="button"
            className={
              showTextRegions
                ? 'editor-button active'
                : 'editor-button'
            }
            onClick={() =>
              setShowTextRegions(
                (current) =>
                  !current,
              )
            }
          >
            {showTextRegions
              ? 'Hide Text Regions'
              : 'Show Text Regions'}
          </button>

          <button
            type="button"
            className="save-edit-button"
            disabled={
              edits.length === 0 ||
              isSaving
            }
            onClick={savePdf}
          >
            {isSaving
              ? 'Saving...'
              : 'Save PDF'}
          </button>

          <label className="editor-button">
            Open Another PDF

            <input
              type="file"
              accept="application/pdf"
              hidden
              onChange={(
                event,
              ) =>
                handleOpenPdf(
                  event
                    .target
                    .files?.[0] ??
                    null,
                )
              }
            />
          </label>
        </div>
      </header>

      <div className="editor-layout">
        <aside className="editor-sidebar">
          <div className="sidebar-heading">
            Pages
          </div>

          <div className="editor-thumbnails">
            {thumbnails.map(
              (thumbnail) => (
                <button
                  type="button"
                  key={
                    thumbnail
                      .pageNumber
                  }
                  className={
                    selectedPage ===
                    thumbnail.pageNumber
                      ? 'editor-thumbnail selected'
                      : 'editor-thumbnail'
                  }
                  onClick={() => {
                    setSelectedPage(
                      thumbnail.pageNumber,
                    )

                    setSelectedRegion(
                      null,
                    )
                  }}
                >
                  <img
                    src={
                      thumbnail
                        .imageUrl
                    }
                    alt={`Page ${thumbnail.pageNumber}`}
                  />

                  <span>
                    Page{' '}
                    {
                      thumbnail
                        .pageNumber
                    }
                  </span>
                </button>
              ),
            )}
          </div>
        </aside>

        <main className="editor-workspace">
          <div className="editor-toolbar">
            <span>
              Page {selectedPage}
              {' '}of{' '}
              {pdfDocument.numPages}
            </span>

            <span className="text-count">
              {textRegions.length}
              {' '}text regions
              {' • '}
              {
                currentPageEdits
                  .length
              }
              {' '}edited
            </span>
          </div>

          <div className="page-stage-scroll">
            <div
              className="page-stage"
              style={{
                width:
                  pageWidth,

                height:
                  pageHeight,
              }}
            >
              <canvas
                ref={canvasRef}
                className="editor-canvas"
              />

              <div className="text-region-layer">
                {textRegions.map(
                  (region) => {
                    const edit =
                      findEdit(
                        region.id,
                      )

                    return (
                      <button
                        type="button"
                        key={
                          region.id
                        }
                        title={
                          edit
                            ? edit.replacementText
                            : region.text
                        }
                        className={
                          edit
                            ? 'text-region edited'
                            : showTextRegions
                              ? 'text-region'
                              : 'text-region hidden-region'
                        }
                        style={{
                          left:
                            region.x,

                          top:
                            region.y,

                          width:
                            region.width,

                          height:
                            region.height,
                        }}
                        onClick={() =>
                          openTextEditor(
                            region,
                          )
                        }
                      >
                        {edit && (
                          <span
                            className="replacement-preview"
                            style={{
                              fontSize:
                                region.fontSize,
                            }}
                          >
                            {
                              edit.replacementText
                            }
                          </span>
                        )}
                      </button>
                    )
                  },
                )}
              </div>
            </div>
          </div>
        </main>
      </div>

      {selectedRegion && (
        <div
          className="text-edit-backdrop"
          onMouseDown={(
            event,
          ) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              cancelTextEdit()
            }
          }}
        >
          <div className="text-edit-dialog">
            <div className="text-edit-heading">
              <div>
                <h3>
                  Edit Text
                </h3>

                <span>
                  Page{' '}
                  {
                    selectedRegion
                      .pageNumber
                  }
                </span>
              </div>

              <button
                type="button"
                className="dialog-close"
                onClick={
                  cancelTextEdit
                }
              >
                ×
              </button>
            </div>

            <label className="text-edit-label">
              Original
            </label>

            <div className="original-text-preview">
              {
                selectedRegion
                  .text
              }
            </div>

            <label
              className="text-edit-label"
              htmlFor="replacement-text"
            >
              Replacement
            </label>

            <textarea
              id="replacement-text"
              className="text-edit-input"
              autoFocus
              value={editValue}
              onChange={(
                event,
              ) =>
                setEditValue(
                  event.target
                    .value,
                )
              }
              onKeyDown={(
                event,
              ) => {
                if (
                  event.key ===
                  'Escape'
                ) {
                  cancelTextEdit()
                }

                if (
                  event.key ===
                    'Enter' &&
                  (event.ctrlKey ||
                    event.metaKey)
                ) {
                  applyTextEdit()
                }
              }}
            />

            <div className="text-edit-help">
              Ctrl + Enter to apply
            </div>

            <div className="text-edit-actions">
              {findEdit(
                selectedRegion.id,
              ) && (
                <button
                  type="button"
                  className="remove-edit-button"
                  onClick={() =>
                    removeEdit(
                      selectedRegion.id,
                    )
                  }
                >
                  Restore Original
                </button>
              )}

              <div className="text-edit-actions-right">
                <button
                  type="button"
                  className="editor-button"
                  onClick={
                    cancelTextEdit
                  }
                >
                  Cancel
                </button>

                <button
                  type="button"
                  className="apply-edit-button"
                  onClick={
                    applyTextEdit
                  }
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}