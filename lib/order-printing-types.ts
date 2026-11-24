/** Shared upload constraints; the server independently verifies every file. */
export const PRINTING_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const PRINTING_MAX_FILES = 10;
export const PRINTING_ACCEPT = ".pdf,.docx,.jpg,.jpeg,.png";

export type PrintingFile = {
  id: string;
  fileName: string;
  sizeBytes: number;
  contentType: string;
  notes: string;
  createdAt: string;
};

export const PRINTING_CONTENT_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
} as const;

export function printingFileError(fileName: string, sizeBytes: number): string | null {
  if (!fileName.trim() || fileName.length > 200 || /[\\/\u0000-\u001f\u007f]/.test(fileName)) {
    return "Use a file name of up to 200 characters, without folders or special control characters.";
  }
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (!extension || !Object.prototype.hasOwnProperty.call(PRINTING_CONTENT_TYPES, extension)) {
    return "Choose a PDF, Word (.docx), JPG or PNG file.";
  }
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) return "This file is empty. Choose a file with your printing matter.";
  if (sizeBytes > PRINTING_MAX_FILE_BYTES) return "Choose a file up to 20 MB.";
  return null;
}
