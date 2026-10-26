/**
 * Resizes and compresses user-uploaded image files using client-side canvas.
 * This ensures uploaded profile avatars and custom banners stay feather-light
 * (~15KB - 75KB) and avoids database bloat, CORS errors, or broken external links.
 */
export async function processImageUpload(
  file: File,
  maxWidth: number,
  maxHeight: number,
  quality = 0.88
): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please select an image file (PNG, JPG, WebP, or GIF).')
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Failed to read image file.'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Failed to decode image.'))
      img.onload = () => {
        let width = img.naturalWidth || img.width
        let height = img.naturalHeight || img.height

        // If it's already compact, return directly
        if (width <= maxWidth && height <= maxHeight && file.size < 180_000) {
          resolve(reader.result as string)
          return
        }

        const scale = Math.min(1, maxWidth / width, maxHeight / height)
        width = Math.max(1, Math.round(width * scale))
        height = Math.max(1, Math.round(height * scale))

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(reader.result as string)
          return
        }

        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, 0, 0, width, height)

        const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
        try {
          const dataUrl = canvas.toDataURL(mime, quality)
          resolve(dataUrl)
        } catch {
          resolve(reader.result as string)
        }
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}
