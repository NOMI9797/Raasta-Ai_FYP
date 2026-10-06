"""
Indeed job search for the Lead Scraper, using JobSpy (free, open source).

Called by libs/indeed-job-search.js. Reads one JSON request on stdin and
writes one JSON response on stdout:

  request:  {"query": "react developer", "location": "Lahore", "country": "pakistan",
             "limit": 25, "hoursOld": 720}
  response: {"jobs": [...]}            on success
            {"error": "..."}           on failure (exit code 1)

Run by hand:
  echo '{"query":"react developer","location":"Lahore","country":"pakistan","limit":5}' \
    | services/indeed-search/.venv/bin/python services/indeed-search/search.py
"""

import json
import math
import sys


def clean(value):
    """JobSpy returns pandas NaN/None/NaT for empty cells; turn them into None."""
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    text = str(value).strip()
    if not text or text.lower() in ("nan", "none", "nat"):
        return None
    return value


def text_or_none(value):
    value = clean(value)
    return str(value).strip() if value is not None else None


def format_salary(row):
    low, high = clean(row.get("min_amount")), clean(row.get("max_amount"))
    if low is None and high is None:
        return None
    currency = text_or_none(row.get("currency")) or ""
    interval = text_or_none(row.get("interval"))

    def fmt(n):
        return f"{int(float(n)):,}"

    amount = f"{fmt(low)} - {fmt(high)}" if low is not None and high is not None else fmt(low if low is not None else high)
    return " ".join(part for part in (currency, amount, f"/ {interval}" if interval else None) if part)


def company_page(url):
    # Jobs without a company come back as e.g. "https://pk.indeed.comNone"
    url = text_or_none(url)
    if not url or url.endswith("None") or "/cmp/" not in url:
        return None
    return url


def to_job(row):
    emails = clean(row.get("emails"))
    if isinstance(emails, str):
        emails = [e.strip() for e in emails.split(",") if e.strip()]
    date_posted = clean(row.get("date_posted"))

    return {
        "url": text_or_none(row.get("job_url")),
        "title": text_or_none(row.get("title")),
        "company": text_or_none(row.get("company")),
        "location": text_or_none(row.get("location")),
        "salary": format_salary(row),
        "jobType": text_or_none(row.get("job_type")),
        "isRemote": bool(clean(row.get("is_remote"))),
        "datePosted": str(date_posted) if date_posted is not None else None,
        "description": (text_or_none(row.get("description")) or "")[:2000],
        "emails": emails or [],
        "companyIndeedUrl": company_page(row.get("company_url")),
        "companyWebsite": text_or_none(row.get("company_url_direct")),
        "companyIndustry": text_or_none(row.get("company_industry")),
        "companyEmployees": text_or_none(row.get("company_num_employees")),
        "companyRevenue": text_or_none(row.get("company_revenue")),
        "companyAddresses": text_or_none(row.get("company_addresses")),
        "companyDescription": (text_or_none(row.get("company_description")) or "")[:1000] or None,
        "companyLogo": text_or_none(row.get("company_logo")),
    }


def main():
    request = json.loads(sys.stdin.read() or "{}")
    query = (request.get("query") or "").strip()
    location = (request.get("location") or "").strip()
    if not query and not location:
        raise ValueError("At least one of query/location is required")

    from jobspy import scrape_jobs  # imported late so bad input fails fast

    kwargs = {
        "site_name": ["indeed"],
        "search_term": query or None,
        "location": location or None,
        "results_wanted": max(1, min(int(request.get("limit") or 25), 200)),
        "country_indeed": request.get("country") or "pakistan",
        "description_format": "markdown",
        "verbose": 0,
    }
    if request.get("hoursOld"):
        kwargs["hours_old"] = int(request["hoursOld"])

    frame = scrape_jobs(**kwargs)
    jobs = [to_job(row) for row in frame.to_dict(orient="records")]
    jobs = [job for job in jobs if job["url"]]
    json.dump({"jobs": jobs}, sys.stdout)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # report every failure as JSON so the caller can show it
        json.dump({"error": f"{type(error).__name__}: {error}"}, sys.stdout)
        sys.exit(1)
