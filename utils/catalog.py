import os
import requests

# Base URL for the API
# Pre-production
BASE_URL = "https://preprod.dados.gov.pt/api/1/site/catalog.xml?tag=hvd&" 
# Production
#BASE_URL = "https://dados.gov.pt/api/1/site/catalog.xml?tag=hvd&" 
# Development
#BASE_URL = "https://172.31.204.12/api/1/site/catalog.xml?tag=hvd&"
#  Test 
#BASE_URL = "https://10.55.37.34/api/1/site/catalog.xml?tag=hvd&" 

# Output file name
OUTPUT_FILE = os.path.join(os.getcwd(), "catalog.ttl")

# Create the output directory if it does not exist
os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)

# Initialize page counter
page = 1

# Open the output file for writing
with open(OUTPUT_FILE, "w", encoding="utf-8") as file:
    while True:
        try:
            # Construct the URL with the current page number
            #url = f"{BASE_URL}?page={page}"
            url = f"{BASE_URL}page={page}"
            print(f"Fetching: {url}")

            # Make the HTTP GET request
            response = requests.get(url, verify=False)  # Disable SSL verification for this example

            # Check if the response status code indicates success
            if response.status_code == 404:
                print("Received status code 404. No more pages available. Stopping.")
                break

            if response.status_code != 200:
                print(f"Page {page} returned {response.status_code}. Skipping.")
                page += 1
                continue

            # Write the content of the current page to the output file
            file.write(response.text)

            # Increment the page number
            page += 1

        except requests.RequestException as e:
            # Handle network or request-related errors
            print(f"An error occurred: {e}")
            break

print("Fetching completed. Results saved in catalog.ttl.")
