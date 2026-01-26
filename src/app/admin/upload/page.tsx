'use client'

import { useState } from 'react'
import { createBrowserSupabaseClient } from '@/lib/supabase-browser'

type UploadType = 'projects' | 'publications' | 'patents' | 'clinical_studies'

export default function UploadPage() {
  const [selectedType, setSelectedType] = useState<UploadType>('projects')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const supabase = createBrowserSupabaseClient()

  const uploadTypes: { value: UploadType; label: string; description: string }[] = [
    {
      value: 'projects',
      label: 'Projects',
      description: 'NIH RePORTER projects CSV with application_id, project_number, title, etc.',
    },
    {
      value: 'publications',
      label: 'Publications',
      description: 'Publications CSV with pmid, title, journal, authors, etc.',
    },
    {
      value: 'patents',
      label: 'Patents',
      description: 'Patents CSV with patent_id, project_number, patent_title, etc.',
    },
    {
      value: 'clinical_studies',
      label: 'Clinical Studies',
      description: 'Clinical trials CSV with nct_number, study_title, etc.',
    },
  ]

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      if (!selectedFile.name.endsWith('.csv')) {
        setError('Please select a CSV file')
        return
      }
      setFile(selectedFile)
      setError(null)
    }
  }

  const handleUpload = async () => {
    if (!file) {
      setError('Please select a file')
      return
    }

    setUploading(true)
    setError(null)
    setSuccess(null)
    setProgress('Uploading file...')

    try {
      // Upload file to Supabase Storage
      const fileName = `${selectedType}/${Date.now()}_${file.name}`
      const { error: uploadError } = await supabase.storage
        .from('etl-uploads')
        .upload(fileName, file)

      if (uploadError) {
        // If bucket doesn't exist, provide helpful message
        if (uploadError.message.includes('Bucket not found')) {
          throw new Error(
            'Storage bucket "etl-uploads" not found. Please create it in Supabase dashboard.'
          )
        }
        throw uploadError
      }

      setProgress('File uploaded. Creating ETL job...')

      // Create ETL job record
      const { data: job, error: jobError } = await supabase
        .from('etl_jobs')
        .insert({
          job_type: `upload_${selectedType}`,
          status: 'pending',
          config: {
            file_path: fileName,
            data_type: selectedType,
          },
        })
        .select()
        .single()

      if (jobError) {
        throw jobError
      }

      setProgress('Triggering ETL process...')

      // Trigger the ETL API endpoint
      const response = await fetch('/api/admin/etl/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.id }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to start ETL process')
      }

      setSuccess(
        `File uploaded successfully! ETL job ${job.id} has been created. Check the Jobs page for status.`
      )
      setFile(null)
      // Reset file input
      const fileInput = document.getElementById('file-input') as HTMLInputElement
      if (fileInput) fileInput.value = ''
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      setProgress(null)
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Upload Data</h1>
        <p className="mt-1 text-sm text-gray-500">
          Import NIH RePORTER CSV files to update the database
        </p>
      </div>

      {/* Upload Type Selection */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          1. Select Data Type
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {uploadTypes.map((type) => (
            <label
              key={type.value}
              className={`flex items-start p-4 border rounded-lg cursor-pointer transition-colors ${
                selectedType === type.value
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <input
                type="radio"
                name="uploadType"
                value={type.value}
                checked={selectedType === type.value}
                onChange={() => setSelectedType(type.value)}
                className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500"
              />
              <div className="ml-3">
                <div className="text-sm font-medium text-gray-900">
                  {type.label}
                </div>
                <div className="text-xs text-gray-500">{type.description}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* File Upload */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          2. Select CSV File
        </h2>
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
          <input
            id="file-input"
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="hidden"
          />
          <label
            htmlFor="file-input"
            className="cursor-pointer inline-flex flex-col items-center"
          >
            <svg
              className="w-12 h-12 text-gray-400 mb-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
            <span className="text-blue-600 hover:text-blue-500 font-medium">
              Click to select a file
            </span>
            <span className="text-sm text-gray-500 mt-1">CSV files only</span>
          </label>
        </div>
        {file && (
          <div className="mt-4 flex items-center justify-between bg-gray-50 rounded-lg p-4">
            <div className="flex items-center space-x-3">
              <svg
                className="w-8 h-8 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <div>
                <div className="text-sm font-medium text-gray-900">
                  {file.name}
                </div>
                <div className="text-xs text-gray-500">
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </div>
              </div>
            </div>
            <button
              onClick={() => setFile(null)}
              className="text-gray-400 hover:text-gray-500"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Upload Button */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          3. Start Upload
        </h2>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {success && (
          <div className="mb-4 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">
            {success}
          </div>
        )}

        {progress && (
          <div className="mb-4 bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded flex items-center">
            <svg
              className="animate-spin -ml-1 mr-3 h-5 w-5 text-blue-600"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            {progress}
          </div>
        )}

        <button
          onClick={handleUpload}
          disabled={!file || uploading}
          className="w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {uploading ? 'Uploading...' : 'Upload and Process'}
        </button>
      </div>

      {/* Instructions */}
      <div className="bg-gray-50 rounded-lg p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Instructions</h3>
        <ul className="text-sm text-gray-600 space-y-2">
          <li>
            1. Download data from{' '}
            <a
              href="https://reporter.nih.gov/exporter"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline"
            >
              NIH RePORTER Exporter
            </a>
          </li>
          <li>2. Select the appropriate data type above</li>
          <li>3. Upload the CSV file</li>
          <li>
            4. The ETL pipeline will process the data and run the classification
            algorithm
          </li>
        </ul>
      </div>
    </div>
  )
}
