'use client';

import Link from 'next/link';
import {
  Upload, Sparkles, GitCompare, Shield, Zap, Repeat, FileDown,
} from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      {/* Nav */}
      <nav className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <span className="text-lg font-bold text-gray-900">DataCleanr</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="#pricing" className="text-sm text-gray-600 hover:text-gray-900">Pricing</a>
            <Link href="/upload" className="btn-primary">
              Try Free
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pt-20 pb-16 text-center">
        <div className="inline-flex items-center gap-2 rounded-full bg-primary-50 px-4 py-1.5 text-sm text-primary-700 mb-6">
          <Sparkles className="h-3.5 w-3.5" />
          AI-Powered Data Cleaning for ML Engineers
        </div>
        <h1 className="text-5xl font-bold tracking-tight text-gray-900 sm:text-6xl">
          Clean data in minutes,
          <br />
          <span className="text-primary-600">not days.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-gray-600">
          Upload your messy dataset, tell our AI what you need in plain English,
          and get clean, ML-ready data back. No more writing Pandas scripts at 2 AM.
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          <Link href="/upload" className="btn-primary text-base px-8 py-3">
            <Upload className="mr-2 h-5 w-5" />
            Upload Your Data
          </Link>
          <a href="#how-it-works" className="btn-secondary text-base px-8 py-3">
            See How It Works
          </a>
        </div>
        <p className="mt-4 text-sm text-gray-500">
          Free tier: 5,000 rows/month. No credit card required.
        </p>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="bg-white py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-3xl font-bold text-gray-900">
            Three steps to clean data
          </h2>
          <div className="mt-16 grid gap-8 md:grid-cols-3">
            {[
              {
                icon: Upload,
                step: '1',
                title: 'Upload',
                desc: 'Drag and drop your CSV, JSON, Excel, or JSONL file. Our AI instantly profiles your data and generates a health report.',
              },
              {
                icon: Sparkles,
                step: '2',
                title: 'Describe',
                desc: 'Tell the AI what you need in plain English: "Remove duplicates, mask emails, standardize dates." Or use one-click preset actions.',
              },
              {
                icon: FileDown,
                step: '3',
                title: 'Export',
                desc: 'Review every change with a visual diff, accept or reject individual modifications, then download your clean data.',
              },
            ].map((item) => (
              <div key={item.step} className="card text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary-100 text-primary-600">
                  <item.icon className="h-6 w-6" />
                </div>
                <div className="mb-2 text-sm font-medium text-primary-600">Step {item.step}</div>
                <h3 className="mb-2 text-xl font-semibold text-gray-900">{item.title}</h3>
                <p className="text-sm text-gray-600">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-3xl font-bold text-gray-900">
            Built for ML workflows
          </h2>
          <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: Zap,
                title: 'AI Data Profiling',
                desc: 'Automatic schema detection, missing value analysis, outlier detection, and quality scoring in seconds.',
              },
              {
                icon: Sparkles,
                title: 'Natural Language Cleaning',
                desc: 'Describe what you want in plain English. AI understands and generates deterministic cleaning scripts.',
              },
              {
                icon: Shield,
                title: 'PII Detection & Masking',
                desc: 'Automatically detect and redact emails, phone numbers, addresses, SSNs, and Chinese ID numbers.',
              },
              {
                icon: Repeat,
                title: 'Smart Deduplication',
                desc: 'Exact and fuzzy duplicate detection. AI identifies near-duplicates that simple matching misses.',
              },
              {
                icon: GitCompare,
                title: 'Visual Diff Review',
                desc: 'See every change before applying. Accept or reject individual modifications like a Git code review.',
              },
              {
                icon: FileDown,
                title: 'Reusable Recipes',
                desc: 'Save your cleaning steps as reusable recipes. Apply the same pipeline to new data with one click.',
              },
            ].map((f) => (
              <div key={f.title} className="card">
                <f.icon className="mb-3 h-6 w-6 text-primary-600" />
                <h3 className="mb-2 text-lg font-semibold text-gray-900">{f.title}</h3>
                <p className="text-sm text-gray-600">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Problem */}
      <section className="bg-gray-900 py-20 text-white">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <h2 className="text-3xl font-bold">
            80% of ML time is spent cleaning data.
          </h2>
          <p className="mt-6 text-lg text-gray-400">
            Data scientists spend more time wrestling with CSV files than building models.
            Hand-written Pandas scripts are fragile, hard to review, and impossible to reuse.
            <br /><br />
            DataCleanr turns 3 days of data cleaning into 3 minutes.
          </p>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20">
        <div className="mx-auto max-w-4xl px-6">
          <h2 className="text-center text-3xl font-bold text-gray-900">
            Simple pricing
          </h2>
          <div className="mt-12 grid gap-8 md:grid-cols-2">
            {/* Free */}
            <div className="card">
              <h3 className="text-lg font-semibold text-gray-900">Free</h3>
              <div className="mt-2">
                <span className="text-4xl font-bold text-gray-900">$0</span>
                <span className="text-gray-500">/month</span>
              </div>
              <ul className="mt-6 space-y-3 text-sm text-gray-600">
                <li className="flex items-center gap-2">
                  <span className="text-emerald-500">✓</span> 5,000 rows/month
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-emerald-500">✓</span> 10MB file upload
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-emerald-500">✓</span> AI cleaning (3/day)
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-emerald-500">✓</span> All preset operations
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-emerald-500">✓</span> CSV export
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-emerald-500">✓</span> 3 saved recipes
                </li>
              </ul>
              <Link href="/upload" className="btn-secondary mt-8 w-full">
                Get Started Free
              </Link>
            </div>

            {/* Pro */}
            <div className="card border-primary-200 ring-2 ring-primary-500">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Pro</h3>
                <span className="badge bg-primary-100 text-primary-800">Popular</span>
              </div>
              <div className="mt-2">
                <span className="text-4xl font-bold text-gray-900">$49</span>
                <span className="text-gray-500">/month</span>
              </div>
              <ul className="mt-6 space-y-3 text-sm text-gray-600">
                <li className="flex items-center gap-2">
                  <span className="text-emerald-500">✓</span> 500,000 rows/month
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-emerald-500">✓</span> 100MB file upload
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-emerald-500">✓</span> Unlimited AI cleaning
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-emerald-500">✓</span> All preset operations
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-emerald-500">✓</span> CSV/JSON/JSONL/Excel export
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-emerald-500">✓</span> Unlimited recipes
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-emerald-500">✓</span> Clean history (unlimited)
                </li>
              </ul>
              <Link href="/upload" className="btn-primary mt-8 w-full">
                Start Pro Trial
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-primary-600 py-16">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <h2 className="text-3xl font-bold text-white">
            Ready to clean your data?
          </h2>
          <p className="mt-4 text-lg text-primary-100">
            Upload your dataset and see results in under a minute.
          </p>
          <Link href="/upload" className="mt-8 inline-flex items-center rounded-lg bg-white px-8 py-3 text-base font-semibold text-primary-600 shadow-sm transition-colors hover:bg-primary-50">
            <Upload className="mr-2 h-5 w-5" />
            Try DataCleanr Free
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white py-8">
        <div className="mx-auto max-w-6xl px-6 text-center text-sm text-gray-500">
          <p>© 2026 DataCleanr. Clean data in minutes, not days.</p>
        </div>
      </footer>
    </div>
  );
}
