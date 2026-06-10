#!/usr/bin/env python3
"""
Clean WordPress block comments and Stackable CSS from blog posts,
then update them in Supabase via the Management API.
"""

import json
import os
import re
import subprocess
import sys

SUPABASE_PROJECT_ID = "oqzloydhoekvgncfvddh"
SUPABASE_TOKEN = os.environ.get("SUPABASE_ACCESS_TOKEN")
WP_POSTS_PATH = "/Users/cataholic/Desktop/airport/realreal/Wordpress/wp_posts.json"


def clean_wordpress_html(html: str) -> str:
    """Remove WordPress block comments and Stackable-specific markup."""

    # 0. Convert stackable icon-list blocks to clean <ul>/<li> lists
    def convert_icon_list(match):
        block = match.group(0)
        # Extract all list item text content
        items = re.findall(r'<p[^>]*>(.*?)</p>', block, re.DOTALL)
        if not items:
            return ''
        li_items = '\n'.join(f'<li>{item.strip()}</li>' for item in items)
        return f'<ul>\n{li_items}\n</ul>'

    html = re.sub(
        r'<!-- wp:stackable/icon-list\b[^>]*-->.*?<!-- /wp:stackable/icon-list -->',
        convert_icon_list,
        html,
        flags=re.DOTALL
    )

    # 0b. Remove any remaining stackable icon-list-item comments/wrappers
    html = re.sub(
        r'<!-- wp:stackable/icon-list-item[^>]*-->', '', html
    )
    html = re.sub(
        r'<!-- /wp:stackable/icon-list-item -->', '', html
    )

    # 1. Remove stackable spacer blocks entirely (they're just empty spacing divs)
    html = re.sub(
        r'<!-- wp:stackable/spacer[^>]*-->\s*<div[^>]*class="[^"]*stk-block-spacer[^"]*"[^>]*>.*?</div>\s*<!-- /wp:stackable/spacer -->',
        '',
        html,
        flags=re.DOTALL
    )

    # 2. Remove stackable table-of-contents blocks entirely
    #    (the TOC is auto-generated and won't work outside WordPress)
    html = re.sub(
        r'<!-- wp:stackable/table-of-contents[^>]*-->\s*<nav[^>]*>.*?</nav>\s*<!-- /wp:stackable/table-of-contents -->',
        '',
        html,
        flags=re.DOTALL
    )

    # 3. Unwrap stackable/text blocks: keep inner text content, remove wrapper div
    def unwrap_stackable_text(match):
        block = match.group(0)
        # Remove the outer div wrapper but keep inner paragraph/text content
        # First remove <style>...</style> tags
        inner = re.sub(r'<style>[^<]*</style>', '', block)
        # Remove the opening comment
        inner = re.sub(r'<!-- wp:stackable/text[^>]*-->\s*', '', inner)
        # Remove the closing comment
        inner = re.sub(r'\s*<!-- /wp:stackable/text -->', '', inner)
        # Remove the outer div wrapper
        inner = re.sub(
            r'<div[^>]*class="[^"]*wp-block-stackable-text[^"]*"[^>]*>\s*',
            '',
            inner
        )
        # Remove the closing </div> that wrapped the content
        # We need to remove the last </div>
        inner = re.sub(r'\s*</div>\s*$', '', inner.strip())
        # Clean stk classes from inner elements
        inner = re.sub(r'\s*class="stk-block-text__text"', '', inner)
        return inner.strip()

    html = re.sub(
        r'<!-- wp:stackable/text[^>]*-->.*?<!-- /wp:stackable/text -->',
        unwrap_stackable_text,
        html,
        flags=re.DOTALL
    )

    # 4. Remove ALL remaining <!-- wp:xxx --> and <!-- /wp:xxx --> block comments
    html = re.sub(r'<!--\s*/?\s*wp:[^>]*-->', '', html)

    # 5. Remove inline <style> blocks that contain stk references
    html = re.sub(r'<style>[^<]*stk[^<]*</style>', '', html)

    # 6. Remove data-block-id attributes
    html = re.sub(r'\s*data-block-id="[^"]*"', '', html)

    # 7. Clean up stk-specific classes from remaining elements
    def clean_classes(match):
        full = match.group(0)
        classes = match.group(1)
        # Remove stk-specific classes
        cleaned = re.sub(r'\bstk-[a-zA-Z0-9_-]+\b', '', classes)
        cleaned = re.sub(r'\bstk--[a-zA-Z0-9_-]+\b', '', cleaned)
        cleaned = re.sub(r'\bwp-block-stackable-[a-zA-Z0-9_-]+\b', '', cleaned)
        # Clean up extra spaces
        cleaned = re.sub(r'\s+', ' ', cleaned).strip()
        if not cleaned:
            return ''
        return f'class="{cleaned}"'

    html = re.sub(r'class="([^"]*)"', clean_classes, html)

    # 8. Remove WordPress-specific classes that aren't useful
    def clean_wp_classes(match):
        classes = match.group(1)
        # Remove has-medium-font-size, has-large-font-size etc.
        cleaned = re.sub(r'\bhas-[a-zA-Z]+-font-size\b', '', classes)
        cleaned = re.sub(r'\s+', ' ', cleaned).strip()
        if not cleaned:
            return ''
        return f'class="{cleaned}"'

    html = re.sub(r'class="([^"]*)"', clean_wp_classes, html)

    # 9. Remove empty class attributes
    html = re.sub(r'\s*class=""', '', html)

    # 10. Remove inline styles with stk CSS variables
    html = re.sub(r'\s*style="[^"]*var\(--stk[^"]*"', '', html)

    # 10b. Remove hidden SVG defs blocks (used by stackable icon lists)
    html = re.sub(r'<svg style="display:none"><defs>.*?</defs></svg>', '', html, flags=re.DOTALL)

    # 10c. Remove id attributes containing stk-
    html = re.sub(r'\s*id="stk-[^"]*"', '', html)

    # 11. Clean up empty divs left behind
    html = re.sub(r'<div\s*>\s*</div>', '', html)

    # 12. Clean up excessive blank lines (3+ newlines -> 2)
    html = re.sub(r'\n{3,}', '\n\n', html)

    # 13. Strip leading/trailing whitespace
    html = html.strip()

    return html


def update_supabase(slug: str, content_html: str):
    """Update a post in Supabase using the Management API."""
    if not SUPABASE_TOKEN:
        raise RuntimeError("SUPABASE_ACCESS_TOKEN is required")

    # Escape single quotes for SQL
    escaped = content_html.replace("'", "''")
    escaped_slug = slug.replace("'", "''")

    query = f"UPDATE posts SET content_html = '{escaped}' WHERE slug = '{escaped_slug}';"

    payload = json.dumps({"query": query})

    result = subprocess.run(
        [
            "curl", "-s", "-X", "POST",
            f"https://api.supabase.com/v1/projects/{SUPABASE_PROJECT_ID}/database/query",
            "-H", f"Authorization: Bearer {SUPABASE_TOKEN}",
            "-H", "Content-Type: application/json",
            "-d", payload
        ],
        capture_output=True,
        text=True
    )

    return result.stdout, result.stderr


def main():
    with open(WP_POSTS_PATH) as f:
        posts = json.load(f)

    print(f"Loaded {len(posts)} posts from {WP_POSTS_PATH}")
    print()

    for post in posts:
        slug = post["slug"]
        raw_content = post["content"]

        if not raw_content:
            print(f"[SKIP] {slug}: no content")
            continue

        cleaned = clean_wordpress_html(raw_content)

        print(f"[{slug}]")
        print(f"  Raw length:     {len(raw_content)}")
        print(f"  Cleaned length: {len(cleaned)}")

        # Verify no wp: comments remain
        remaining_comments = re.findall(r'<!--.*?wp:.*?-->', cleaned)
        if remaining_comments:
            print(f"  WARNING: {len(remaining_comments)} wp: comments still present!")
            for c in remaining_comments[:3]:
                print(f"    {c[:80]}")

        # Verify no stk classes remain
        remaining_stk = re.findall(r'\bstk-', cleaned)
        if remaining_stk:
            print(f"  WARNING: {len(remaining_stk)} stk- references still present!")

        # Update Supabase
        stdout, stderr = update_supabase(slug, cleaned)
        if stderr:
            print(f"  ERROR: {stderr}")
        else:
            print(f"  Supabase response: {stdout[:200]}")
        print()


if __name__ == "__main__":
    main()
