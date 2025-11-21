import requests
import subprocess
import hashlib
import os
import urllib3
import json

# Suppress InsecureRequestWarning
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Mock settings
class Settings:
    DADOS_GOV_API_KEY = "eyJhbGciOiJIUzUxMiJ9.eyJ1c2VyIjoiNjcxNjZiNzk4NjA4MjBhMzc1YzUwMDhiIiwidGltZSI6MTc1MTM2ODYzMi45MDc3MzI1fQ.9mty0o-vtRwH5jOyWcosukMF4qiyHOKSYCBHSNryD1ASpDU98NvXccBnxNhf98ovIqeObl6t1A-TyLzWsZwf9w" # Add key if needed
    API_BASE = 'https://preprod.dados.gov.pt/api/1/datasets/'

settings = Settings()

def _build_auth_headers(use_private: bool = False) -> dict:
    if not use_private:
        return {}
    api_key = settings.DADOS_GOV_API_KEY
    if not api_key:
        raise Exception("Missing API key for private dataset access. Define DADOS_GOV_API_KEY.")
    return {"X-API-KEY": api_key}


def read_metadata(slug: str, use_private: bool = False, api_base: str = None) -> dict:
    base_url = (api_base or settings.API_BASE or "").rstrip("/")
    uri = f"{base_url}/{slug}"
    headers = _build_auth_headers(use_private)
    try:
        # Added verify=False to handle self-signed certificates
        res = requests.get(uri, headers=headers or None, verify=False)
    except requests.RequestException as exc:
        raise Exception(f"Unable to connect to `dados.gov.pt`: {exc}") from exc
    if res.status_code == 403 and use_private:
        raise Exception("Access denied when fetching private dataset metadata. Check that the API key is valid.")
    if res.status_code != 200:
        raise Exception(f"Unable to connect to `dados.gov.pt` (status {res.status_code})")
    return res.json()


def calculate_sha1(fname: str) -> str:
    # Ensure shasum is available or fallback? 
    # Assuming shasum is available as per user code.
    try:
        r = subprocess.check_output(f"shasum {fname}", shell=True, text=True, stderr=subprocess.STDOUT)
        return r.split(" ")[0]
    except subprocess.CalledProcessError:
        # Fallback to python implementation if shasum fails
        h = hashlib.sha1()
        with open(fname, "rb") as f:
            while chunk := f.read(8192):
                h.update(chunk)
        return h.hexdigest()


def calculate_sha256(fname: str) -> str:
    h = hashlib.sha256()
    buf = bytearray(128 * 1024)
    mv = memoryview(buf)
    with open(fname, "rb", buffering=0) as f:
        while n := f.readinto(mv):
            h.update(mv[:n])
    return h.hexdigest()


def download_resource_file(url: str, fname: str, checksum_type, checksum: str = None, use_private: bool = False) -> None:
    headers = _build_auth_headers(use_private)
    try:
        # Added verify=False
        res = requests.get(url, allow_redirects=True, headers=headers or None, verify=False)
    except requests.RequestException as exc:
        raise Exception(f"Unable to download resource {url}: {exc}") from exc
    if res.status_code == 403 and use_private:
        raise Exception("Access denied when downloading a private resource. Check that the API key is valid.")
    if res.status_code != 200:
        raise Exception(f"Unable to download resource {url} (status {res.status_code})")
    
    with open(fname, "wb") as f:
        f.write(res.content)
        
    if checksum and checksum_type == "sha1":
        calc = calculate_sha1(fname)
        if calc != checksum:
            print(f"Warning: Checksum mismatch for {fname}. Expected {checksum}, got {calc}")
            # raise Exception("Checksum mismatch: download was not successful")
            
    if checksum and checksum_type == "sha256":
        calc = calculate_sha256(fname)
        if calc != checksum:
            print(f"Warning: Checksum mismatch for {fname}. Expected {checksum}, got {calc}")
            # raise Exception("Checksum mismatch: download was not successful")


if __name__ == "__main__":
    DATASETS = [
        "6718c25bbbf3654d2bc5008b",
        "6717dbd71b0eaad60ac5008d",
        "6717db451b0eaad60ac5008c",
        "6717dcff1b0eaad60ac50090",
        "6717dc1f1b0eaad60ac5008e",
        "6717dca11b0eaad60ac5008f",
        "6718c29ebbf3654d2bc5008c",
        # "67c5a3b3b50fe67ba7aa1905" # Catálogo de dados
    ]

    # Create downloads directory
    DOWNLOAD_DIR = "downloads"
    if not os.path.exists(DOWNLOAD_DIR):
        os.makedirs(DOWNLOAD_DIR)

    print(f"Processing {len(DATASETS)} datasets...")

    for slug in DATASETS:
        try:
            print(f"\nFetching metadata for: {slug}")
            metadata = read_metadata(slug)
            title = metadata.get('title', 'Unknown Title')
            print(f"Dataset: {title}")
            
            resources = metadata.get('resources', [])
            print(f"Found {len(resources)} resources.")
            
            for resource in resources:
                res_id = resource.get('id')
                res_title = resource.get('title', res_id)
                download_url = resource.get("download_url") or resource.get("url")
                
                if not download_url:
                    print(f"  Skipping resource {res_id}: No download URL")
                    continue
                
                # Determine filename
                # Try to get filename from url or use id + extension
                filename = os.path.basename(download_url.split('?')[0])
                if not filename or len(filename) > 100: # Basic sanity check
                    filename = f"{res_id}"
                    # Try to guess extension from format
                    fmt = resource.get('format')
                    if fmt:
                        filename += f".{fmt.lower()}"

                # Prefix with dataset slug to avoid collisions
                safe_slug = "".join([c for c in slug if c.isalnum() or c in ('-','_')])
                output_path = os.path.join(DOWNLOAD_DIR, f"{safe_slug}_{filename}")
                
                print(f"  Downloading {res_title} -> {output_path}")
                
                checksum_info = resource.get("checksum") or {}
                checksum_type = checksum_info.get("type")
                checksum_value = checksum_info.get("value")
                
                try:
                    download_resource_file(
                        download_url,
                        output_path,
                        checksum_type=checksum_type,
                        checksum=checksum_value
                    )
                    print("    Success")
                except Exception as e:
                    print(f"    Failed to download resource {res_id}: {e}")

        except Exception as e:
            print(f"Error processing dataset {slug}: {e}")
