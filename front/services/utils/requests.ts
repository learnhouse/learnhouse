export const RequestBody = (method: string, data: any) => {
  let HeadersConfig = new Headers({ "Content-Type": "application/json" });
  let options: any = {
    method: method,
    headers: HeadersConfig,
    redirect: "follow",
    credentials: "include",
  };
  if (data) {
    options.body = JSON.stringify(data);
  }
  return options;
};

export const RequestBodyForm = (method: string, data: any) => {
  let HeadersConfig = new Headers({});
  let options: any = {
    method: method,
    headers: HeadersConfig,
    redirect: "follow",
    credentials: "include",
    body: data,
  };
  return options;
};

export const swrFetcher = async (url: string, body: any) => {
  // Create the request options
  let HeadersConfig = new Headers({ "Content-Type": "application/json" });
  let options: any = {
    method: "GET",
    headers: HeadersConfig,
    redirect: "follow",
    credentials: "include",
  };

  // If there is a body, add it to the request options
  if (body) {
    options.body = JSON.stringify(body);
  }

  // Fetch the data
  const res = await fetch(url, options);

  // If the response is not in the 200 range, throw an error
  if (!res.ok) {
    const error = new Error("An error occurred while fetching the data.");
    throw error;
  }

  // Return the data
  return res.json();
};
