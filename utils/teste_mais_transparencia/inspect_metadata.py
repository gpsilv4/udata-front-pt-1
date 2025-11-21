import requests
import urllib3
import json

# Suppress InsecureRequestWarning
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

API_KEY = "eyJhbGciOiJIUzUxMiJ9.eyJ1c2VyIjoiNjcxNjZiNzk4NjA4MjBhMzc1YzUwMDhiIiwidGltZSI6MTc1MTM2ODYzMi45MDc3MzI1fQ.9mty0o-vtRwH5jOyWcosukMF4qiyHOKSYCBHSNryD1ASpDU98NvXccBnxNhf98ovIqeObl6t1A-TyLzWsZwf9w"
API_BASE = 'https://172.31.204.12/api/1/datasets/'
SLUG = "6718c25bbbf3654d2bc5008b"

def inspect():
    uri = f"{API_BASE}{SLUG}"
    # headers = {"X-API-KEY": API_KEY}
    headers = {}
    
    print(f"Fetching metadata for {SLUG} (No Auth)...")
    try:
        res = requests.get(uri, headers=headers, verify=False)
        if res.status_code != 200:
            print(f"Error: {res.status_code}")
            print(res.text)
            return
            
        data = res.json()
        
        print(f"Dataset Title: {data.get('title')}")
        resources = data.get('resources', [])
        print(f"Total Resources: {len(resources)}")
        
        for i, r in enumerate(resources):
            print(f"\nResource {i+1}:")
            print(f"  ID: {r.get('id')}")
            print(f"  Title: {r.get('title')}")
            print(f"  URL: {r.get('url')}")
            print(f"  Created At: {r.get('created_at')}")
            print(f"  Published: {r.get('published')}")
            
    except Exception as e:
        print(f"Exception: {e}")

if __name__ == "__main__":
    inspect()
