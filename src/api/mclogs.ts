import axios from "axios";

export async function uploadLogs(content: string): Promise<string> {
  try {
    const params = new URLSearchParams();
    params.append("content", content);

    const response = await axios.post("https://api.mclo.gs/1/log", params, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    if (response.data.success) {
      return response.data.url;
    } else {
      throw new Error(response.data.error || "Failed to upload logs");
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(error.response?.data?.error || error.message);
    }
    throw error;
  }
}
