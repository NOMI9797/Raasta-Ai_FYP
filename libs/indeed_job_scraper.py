"""
Indeed Job Scraper (CLI companion)
==================================
Offline / scripting mirror of the in-app Indeed job search (`libs/indeed-job-search.js`).
Uses the same hosted runner credentials as the Next.js server (`SCRAPER_API_TOKEN` / legacy env keys).

Requirements:
    pip install apify-client requests

Usage:
    python3 indeed_job_scraper.py \\
        --keyword "Backend Developer" \\
        --location "Karachi" \\
        --max-results 50 \\
        --country "PK"

    python3 indeed_job_scraper.py \\
        --keyword "Python Django" \\
        --location "Remote" \\
        --max-results 100 \\
        --format both
"""

import os
import json
import csv
import sys
import argparse
import subprocess
from typing import Optional, List, Dict
from datetime import datetime

# Load environment variables from .env file
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    # If dotenv not available, continue anyway
    pass

try:
    from apify_client import ApifyClient
    JOB_RUNNER_SDK_AVAILABLE = True
except ImportError:
    JOB_RUNNER_SDK_AVAILABLE = False

try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False

# Import company enricher
try:
    from company_enricher import CompanyEnricher
    ENRICHER_AVAILABLE = True
except ImportError:
    ENRICHER_AVAILABLE = False

# Import simple enricher (doesn't require hosted runner SDK)
try:
    from company_enricher_simple import SimpleCompanyEnricher
    SIMPLE_ENRICHER_AVAILABLE = True
except ImportError:
    SIMPLE_ENRICHER_AVAILABLE = False

# Import Tavily enricher (search-based, better details)
try:
    from company_enricher_tavily import TavilyCompanyEnricher
    TAVILY_ENRICHER_AVAILABLE = True
except ImportError:
    TAVILY_ENRICHER_AVAILABLE = False


# ─────────────────────────────────────────────────────────────────────────────
# Env helpers
# ─────────────────────────────────────────────────────────────────────────────

def _scraper_token_from_env() -> str:
    return (
        (os.getenv("SCRAPER_API_TOKEN") or "").strip()
        or (os.getenv("SCRAPER_SERVICE_TOKEN") or "").strip()
        or (os.getenv("APIFY_API_TOKEN") or "").strip()
    )


# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

class ApifyConfig:
    """Configuration for Apify scraper."""
    
    # Apify Actor ID for Indeed scraper
    ACTOR_ID = "misceres/indeed-scraper"
    
    # Country code mapping
    COUNTRY_CODES = {
        "us": "US",
        "pk": "PK",
        "uk": "UK",
        "ca": "CA",
        "au": "AU",
        "in": "IN",
        "de": "DE",
        "fr": "FR",
        "ae": "AE",
        "sg": "SG",
    }


# ─────────────────────────────────────────────────────────────────────────────
# Apify Scraper using CLI
# ─────────────────────────────────────────────────────────────────────────────

class ApifyCLIScraper:
    """Scraper using Apify CLI."""
    
    def __init__(self, api_token: Optional[str] = None):
        """Initialize with API token."""
        self.api_token = api_token or _scraper_token_from_env()

        if not self.api_token:
            raise ValueError(
                "❌ Scraper API token not found!\n"
                "   Set SCRAPER_API_TOKEN or pass --api-token\n"
            )
    
    def search(
        self,
        keyword: str,
        location: str,
        max_results: int = 50,
        country: str = "US",
        position: Optional[str] = None
    ) -> List[Dict]:
        """
        Search for jobs using Apify CLI.
        
        Args:
            keyword: Job search keyword
            location: Job location
            max_results: Maximum results to return
            country: Country code
            position: Specific position (if different from keyword)
            
        Returns:
            List of job dictionaries
        """
        print(f"\n🔍 Searching Indeed via Apify...")
        print(f"   Keyword: {keyword}")
        print(f"   Location: {location}")
        print(f"   Country: {country}")
        print(f"   Max results: {max_results}\n")
        
        # Prepare input JSON
        input_data = {
            "position": position or keyword,
            "maxItemsPerSearch": min(max_results, 100),
            "country": country,
            "location": location,
            "parseCompanyDetails": False,
            "saveOnlyUniqueItems": True,
            "followApplyRedirects": False,
            "startUrls": [
                {
                    "url": f"https://www.indeed.com/jobs?q={keyword.replace(' ', '+')}&l={location.replace(' ', '+')}"
                }
            ]
        }
        
        # Convert to JSON string
        input_json = json.dumps(input_data)
        
        # Build Apify CLI command
        cmd = [
            "apify",
            "call",
            ApifyConfig.ACTOR_ID,
            "--silent",
            "--output-dataset"
        ]
        
        try:
            print("  → Calling Apify Actor...")
            
            # Run Apify CLI
            process = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )
            
            stdout, stderr = process.communicate(input=input_json)
            
            if process.returncode != 0:
                print(f"  ✗ Apify CLI error:")
                print(f"     {stderr}")
                return []
            
            # Parse output
            try:
                results = json.loads(stdout)
                if isinstance(results, list):
                    jobs = results
                elif isinstance(results, dict) and "data" in results:
                    jobs = results["data"]
                else:
                    jobs = [results] if results else []
                
                print(f"  ✓ Found {len(jobs)} jobs")
                return self._clean_jobs(jobs)
                
            except json.JSONDecodeError:
                print(f"  ✗ Could not parse response: {stdout[:200]}")
                return []
        
        except FileNotFoundError:
            print("  ✗ Apify CLI not found!")
            print("     Install it: npm install -g apify-cli")
            print("     Or: brew install apify-cli")
            return []
        except Exception as e:
            print(f"  ✗ Error: {str(e)[:200]}")
            return []
    
    @staticmethod
    def _clean_jobs(jobs: List[Dict]) -> List[Dict]:
        """Clean and normalize job data."""
        cleaned = []
        
        for job in jobs:
            try:
                cleaned_job = {
                    "id": job.get("id") or job.get("uniqueId", ""),
                    "title": job.get("positionName") or job.get("title", "N/A"),
                    "company": job.get("companyName") or job.get("company", "N/A"),
                    "location": job.get("location", "N/A"),
                    "salary": job.get("salary") or job.get("salaryText", "Not specified"),
                    "url": job.get("url") or job.get("link", ""),
                    "snippet": job.get("snippet") or job.get("description", "")[:200],
                    "date_posted": job.get("postingDate") or "N/A",
                    "employment_type": job.get("jobType") or "N/A",
                    "is_remote": "remote" in str(job.get("location", "")).lower()
                }
                cleaned.append(cleaned_job)
            except Exception:
                continue
        
        return cleaned


# ─────────────────────────────────────────────────────────────────────────────
# Apify Scraper using API Client
# ─────────────────────────────────────────────────────────────────────────────

class ApifyClientScraper:
    """Scraper using Apify Python client library."""
    
    def __init__(self, api_token: Optional[str] = None):
        """Initialize with API token."""
        if not JOB_RUNNER_SDK_AVAILABLE:
            raise ImportError(
                "Job-runner SDK not installed!\n"
                "Install it: pip install apify-client"
            )
        
        self.api_token = api_token or _scraper_token_from_env()

        if not self.api_token:
            raise ValueError(
                "❌ Scraper API token not found!\n"
                "   Set SCRAPER_API_TOKEN or pass --api-token"
            )

        self.client = ApifyClient(self.api_token)
    
    def search(
        self,
        keyword: str,
        location: str,
        max_results: int = 50,
        country: str = "US",
        position: Optional[str] = None
    ) -> List[Dict]:
        """
        Search for jobs using Apify Python client.
        
        Args:
            keyword: Job search keyword
            location: Job location
            max_results: Maximum results to return
            country: Country code
            position: Specific position (if different from keyword)
            
        Returns:
            List of job dictionaries
        """
        print(f"\n🔍 Searching Indeed via Apify...")
        print(f"   Keyword: {keyword}")
        print(f"   Location: {location}")
        print(f"   Country: {country}")
        print(f"   Max results: {max_results}\n")
        
        # Prepare input
        run_input = {
            "position": position or keyword,
            "maxItemsPerSearch": min(max_results, 100),
            "country": country,
            "location": location,
            "parseCompanyDetails": False,
            "saveOnlyUniqueItems": True,
            "followApplyRedirects": False,
            "startUrls": [
                {
                    "url": f"https://www.indeed.com/jobs?q={keyword.replace(' ', '+')}&l={location.replace(' ', '+')}"
                }
            ]
        }
        
        try:
            print("  → Calling Apify Actor...")
            
            # Run the actor
            run = self.client.actor(ApifyConfig.ACTOR_ID).call(run_input=run_input)
            
            # Get dataset items
            dataset_client = self.client.dataset(run["defaultDatasetId"])
            
            # list_items() returns a ListPage object - convert to list properly
            items_page = dataset_client.list_items()
            jobs = []
            
            # ListPage is paginated result - access items via .items attribute or convert properly
            if hasattr(items_page, 'items'):
                # If it has items attribute, use it
                jobs = items_page.items if isinstance(items_page.items, list) else list(items_page.items) if items_page.items else []
            elif hasattr(items_page, '__dict__') and 'items' in items_page.__dict__:
                jobs = items_page.__dict__['items']
            else:
                # Try to convert ListPage to list if it implements list protocol or has items
                try:
                    jobs = list(items_page) if hasattr(items_page, '__iter__') else [items_page]
                except (TypeError, AttributeError):
                    # Last resort - check if it's dict-like
                    if isinstance(items_page, dict):
                        jobs = items_page.get('items', [])
                    else:
                        jobs = []
            
            print(f"  ✓ Found {len(jobs)} total jobs")
            
            # Clean jobs first
            cleaned = self._clean_jobs(jobs)
            
            # Filter by location if specified
            if location:
                location_lower = location.lower()
                filtered = [
                    job for job in cleaned 
                    if location_lower in job["location"].lower()
                ]
                print(f"  ✓ After location filter ({location}): {len(filtered)} jobs")
                cleaned = filtered
            
            # Limit to max_results
            limited = cleaned[:max_results]
            print(f"  ✓ Limited to {max_results} results: {len(limited)} jobs")
            
            return limited
        
        except Exception as e:
            print(f"  ✗ Error: {str(e)[:200]}")
            import traceback
            traceback.print_exc()
            return []
    
    @staticmethod
    def _clean_jobs(jobs: List[Dict]) -> List[Dict]:
        """Clean and normalize job data."""
        cleaned = []
        
        for job in jobs:
            try:
                cleaned_job = {
                    "id": job.get("id") or job.get("uniqueId", ""),
                    "title": job.get("positionName") or job.get("title", "N/A"),
                    "company": job.get("companyName") or job.get("company", "N/A"),
                    "location": job.get("location", "N/A"),
                    "salary": job.get("salary") or job.get("salaryText", "Not specified"),
                    "url": job.get("url") or job.get("link", ""),
                    "snippet": job.get("snippet") or job.get("description", "")[:200],
                    "date_posted": job.get("postingDate") or "N/A",
                    "employment_type": job.get("jobType") or "N/A",
                    "is_remote": "remote" in str(job.get("location", "")).lower()
                }
                cleaned.append(cleaned_job)
            except Exception:
                continue
        
        return cleaned


# ─────────────────────────────────────────────────────────────────────────────
# Output Formatters
# ─────────────────────────────────────────────────────────────────────────────

class OutputFormatter:
    """Formats and saves job data."""
    
    @staticmethod
    def print_table(jobs: List[Dict]) -> None:
        """Print jobs in formatted table."""
        if not jobs:
            print("\n❌ No jobs found.")
            return
        
        print("\n" + "─" * 130)
        print(f"{'#':<3} {'Title':<30} {'Company':<25} {'Location':<20} {'Salary':<25}")
        print("─" * 130)
        
        for idx, job in enumerate(jobs, 1):
            title = (job["title"][:27] + "...") if len(job["title"]) > 30 else job["title"]
            company = (job["company"][:22] + "...") if len(job["company"]) > 25 else job["company"]
            location = (job["location"][:17] + "...") if len(job["location"]) > 20 else job["location"]
            salary = (job["salary"][:22] + "...") if len(job["salary"]) > 25 else job["salary"]
            
            print(f"{idx:<3} {title:<30} {company:<25} {location:<20} {salary:<25}")
        
        print("─" * 130)
        print(f"\nTotal: {len(jobs)} jobs found\n")
        
        # Print company contact details if available
        has_contact = any(
            job.get("linkedin_url") or job.get("company_email") or job.get("company_phone")
            for job in jobs
        )
        
        if has_contact:
            print("💼 COMPANY CONTACT INFORMATION:")
            print("─" * 130)
            for idx, job in enumerate(jobs, 1):
                print(f"\n{idx}. {job['company']}")
                
                if job.get("linkedin_url"):
                    print(f"   🔗 LinkedIn: {job['linkedin_url']}")
                
                if job.get("company_email"):
                    print(f"   📧 Email: {job['company_email']}")
                
                if job.get("company_phone"):
                    print(f"   📱 Phone: {job['company_phone']}")
                
                if job.get("company_website"):
                    print(f"   🌐 Website: {job['company_website']}")
                
                if not (job.get("linkedin_url") or job.get("company_email") or 
                        job.get("company_phone") or job.get("company_website")):
                    print(f"   ℹ️  No contact information found")
            
            print("\n" + "─" * 130 + "\n")
    
    @staticmethod
    def save_json(jobs: List[Dict], filepath: str = "jobs.json") -> None:
        """Save to JSON."""
        try:
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(jobs, f, indent=2, ensure_ascii=False)
            print(f"✔ Saved {len(jobs)} jobs to {filepath}")
        except Exception as e:
            print(f"✗ Error saving JSON: {e}")
    
    @staticmethod
    def save_csv(jobs: List[Dict], filepath: str = "jobs.csv") -> None:
        """Save to CSV."""
        if not jobs:
            return
        
        try:
            with open(filepath, "w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=jobs[0].keys())
                writer.writeheader()
                writer.writerows(jobs)
            print(f"✔ Saved {len(jobs)} jobs to {filepath}")
        except Exception as e:
            print(f"✗ Error saving CSV: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────

def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Indeed Job Scraper using Apify",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
SETUP:
  1. Create account: https://apify.com/
  2. Get API token: https://console.apify.com/account/integrations
  3. Set env var: export APIFY_API_TOKEN="your_token"
     OR pass: --api-token "your_token"

TAVILY SETUP (Recommended for company enrichment):
  1. Get Tavily API key: https://tavily.com/
  2. Set env var: export TAVILY_API_KEY="your_key"
     OR use RAPIDAPI_KEY: https://rapidapi.com/tavily/api/tavily

EXAMPLES:
  # Basic search (no enrichment)
  python3 indeed_job_scraper.py \\
    --keywords "Backend Developer" \\
    --location "Karachi" \\
    --max-results 50 \\
    --country pk

  # With Tavily company enrichment (recommended - provides better details)
  python3 indeed_job_scraper.py \\
    --keywords "Backend Developer" "Python Developer" \\
    --location "Karachi" \\
    --max-results 10 \\
    --country pk \\
    --enrich-companies

  # With Apify enrichment (alternative - more expensive)
  python3 indeed_job_scraper.py \\
    --keywords "Backend Developer" \\
    --location "Karachi" \\
    --max-results 10 \\
    --country pk \\
    --enrich-companies \\
    --enricher apify

  # Limited plan: enrich only 3 companies to save costs
  python3 indeed_job_scraper.py \\
    --keywords "Backend Developer" \\
    --location "Karachi" \\
    --max-results 10 \\
    --country pk \\
    --enrich-companies \\
    --max-enrichments 3

METHODS:
  --method cli        Use Apify CLI (requires: npm install -g apify-cli)
  --method client     Use Apify Python client (requires: pip install apify-client)

DEFAULT: Tries CLI first, falls back to client library
        """
    )
    
    parser.add_argument("--keywords", nargs="+", required=True, help="Job keywords (can specify multiple, e.g., 'Backend Developer' 'Python' 'Django')")
    parser.add_argument("--location", required=True, help="Job location (e.g., 'Karachi')")
    parser.add_argument("--max-results", type=int, default=50, help="Max results total (default: 50)")
    parser.add_argument("--country", default="us", help="Country code (default: us)")
    parser.add_argument("--api-token", help="Apify API token (or set APIFY_API_TOKEN env var)")
    parser.add_argument("--format", choices=["json", "csv", "both"], default="both", help="Output format")
    parser.add_argument("--output", default="jobs", help="Output filename without extension")
    parser.add_argument("--method", choices=["cli", "client", "auto"], default="auto",
                       help="Scraper method to use")
    parser.add_argument("--enrich-companies", action="store_true",
                       help="Enrich companies with LinkedIn, email, phone using Tavily Search API")
    parser.add_argument("--enricher", choices=["tavily", "apify", "simple"], default="tavily",
                       help="Enricher method: 'tavily' (search-based, better results - default), 'apify' (Google Search), 'simple' (web-based)")
    parser.add_argument("--max-enrichments", type=int, default=None,
                       help="Limit enrichment to N companies to save API units (default: all)")
    
    args = parser.parse_args()
    
    # Validate inputs
    if args.max_results < 1 or args.max_results > 100:
        print("❌ Error: max-results must be between 1 and 100")
        return
    
    # Map country code
    country = ApifyConfig.COUNTRY_CODES.get(args.country.lower(), args.country.upper())
    
    # Choose scraper method
    scraper = None
    
    if args.method in ("cli", "auto"):
        try:
            scraper = ApifyCLIScraper(args.api_token)
            print("✓ Using Apify CLI method")
        except (ValueError, Exception) as e:
            if args.method == "cli":
                print(f"❌ {e}")
                return
            # Fall through to try client
    
    if not scraper and args.method in ("client", "auto"):
        try:
            scraper = ApifyClientScraper(args.api_token)
            print("✓ Using Apify Python client method")
        except (ValueError, ImportError) as e:
            print(f"❌ {e}")
            return
    
    if not scraper:
        print("❌ Could not initialize scraper")
        return
    
    # Search for jobs with multiple keywords
    all_jobs = []
    keywords_list = args.keywords if isinstance(args.keywords, list) else [args.keywords]
    # Request more per keyword to account for location filtering and deduplication
    # Formula: (requested_total * 3) / num_keywords, with minimum of 15 per keyword
    results_per_keyword = min(50, max(15, (args.max_results * 3) // len(keywords_list)))
    
    print(f"\n🔍 Searching {len(keywords_list)} keyword(s) for ~{results_per_keyword} results each...\n")
    
    for idx, keyword in enumerate(keywords_list, 1):
        print(f"  [{idx}/{len(keywords_list)}] Searching: {keyword}")
        jobs = scraper.search(
            keyword=keyword,
            location=args.location,
            max_results=results_per_keyword,
            country=country
        )
        all_jobs.extend(jobs)
        print(f"       Found: {len(jobs)} jobs")
    
    # Remove duplicates (same job title + company + location)
    seen = set()
    jobs = []
    for job in all_jobs:
        key = (job["title"], job["company"], job["location"])
        if key not in seen:
            seen.add(key)
            jobs.append(job)
    
    # Limit to max_results
    jobs = jobs[:args.max_results]
    print(f"\n  After deduplication: {len(jobs)} unique jobs\n")
    
    # Enrich with company details if requested
    if args.enrich_companies:
        try:
            # Choose enricher method
            enricher = None
            
            if args.enricher == "tavily":
                if not TAVILY_ENRICHER_AVAILABLE:
                    print("⚠️  Tavily enricher not available. Switching to Apify.\n")
                    if ENRICHER_AVAILABLE:
                        enricher = CompanyEnricher(args.api_token)
                        print("✓ Using Apify enricher\n")
                    elif SIMPLE_ENRICHER_AVAILABLE:
                        enricher = SimpleCompanyEnricher()
                        print("✓ Using simple web-based enricher\n")
                else:
                    enricher = TavilyCompanyEnricher(args.api_token)
                    print("✓ Using Tavily enricher (search-based, provides better company details)\n")
            
            elif args.enricher == "apify":
                if not ENRICHER_AVAILABLE:
                    print("⚠️  Apify enricher not available. Switching to Tavily.\n")
                    if TAVILY_ENRICHER_AVAILABLE:
                        enricher = TavilyCompanyEnricher(args.api_token)
                        print("✓ Using Tavily enricher\n")
                    elif SIMPLE_ENRICHER_AVAILABLE:
                        enricher = SimpleCompanyEnricher()
                        print("✓ Using simple web-based enricher\n")
                else:
                    enricher = CompanyEnricher(args.api_token)
                    print("✓ Using Apify enricher\n")
            
            elif args.enricher == "simple":
                if not SIMPLE_ENRICHER_AVAILABLE:
                    print("⚠️  Simple enricher not available. Switching to Tavily.\n")
                    if TAVILY_ENRICHER_AVAILABLE:
                        enricher = TavilyCompanyEnricher(args.api_token)
                        print("✓ Using Tavily enricher\n")
                    elif ENRICHER_AVAILABLE:
                        enricher = CompanyEnricher(args.api_token)
                        print("✓ Using Apify enricher\n")
                else:
                    enricher = SimpleCompanyEnricher()
                    print("✓ Using simple web-based enricher\n")
            
            if enricher:
                # Limit enrichment to save API units on limited plans
                max_enrich = args.max_enrichments if args.max_enrichments else len(jobs)
                jobs_to_enrich = jobs[:max_enrich]
                
                if len(jobs_to_enrich) < len(jobs):
                    print(f"💼 Enriching {len(jobs_to_enrich)} of {len(jobs)} jobs (limit: {max_enrich})...\n")
                
                enriched = enricher.enrich_jobs(jobs_to_enrich)
                
                # Put enriched jobs back
                for i, job in enumerate(enriched):
                    if i < len(jobs):
                        jobs[i].update(job)
                
                print()
            else:
                print("❌ No enricher available!\n")
        
        except Exception as e:
            print(f"⚠️  Company enrichment failed: {str(e)[:100]}\n")
    
    # Output results
    formatter = OutputFormatter()
    formatter.print_table(jobs)
    
    if jobs:
        if args.format in ("json", "both"):
            formatter.save_json(jobs, f"{args.output}.json")
        if args.format in ("csv", "both"):
            formatter.save_csv(jobs, f"{args.output}.csv")
        print(f"✔ Done! Successfully scraped {len(jobs)} jobs.")
    else:
        print("❌ No jobs found. Check your inputs or try different parameters.")


if __name__ == "__main__":
    main()
