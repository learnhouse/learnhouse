import FormLayout, { ButtonBlack, Flex, FormField, FormLabel, FormMessage, Input, Textarea } from "@components/UI/Form/Form";
import React, { useState } from "react";
import * as Form from '@radix-ui/react-form';

function VideoModal({ submitFileActivity, chapterId }: any) {
  const [video, setVideo] = React.useState(null) as any;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [name, setName] = React.useState("");

  const handleVideoChange = (event: React.ChangeEvent<any>) => {
    setVideo(event.target.files[0]);
  };

  const handleNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setName(event.target.value);
  };

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    setIsSubmitting(true);
    let status = await submitFileActivity(video, "video", { name, type: "video" }, chapterId);
    setIsSubmitting(false);
  };

  /* TODO : implement some sort of progress bar for file uploads, it is not possible yet because i'm not using axios.
   and the actual upload isn't happening here anyway, it's in the submitFileActivity function */

  return (
      <FormLayout onSubmit={handleSubmit}>
      <FormField name="video-activity-name">
        <Flex css={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
          <FormLabel>Video name</FormLabel>
          <FormMessage match="valueMissing">Please provide a name for your video activity</FormMessage>
        </Flex>
        <Form.Control asChild>
          <Input onChange={handleNameChange} type="text" required />
        </Form.Control>
      </FormField>
      <FormField name="video-activity-file">
        <Flex css={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
          <FormLabel>Video file</FormLabel>
          <FormMessage match="valueMissing">Please provide a video for your activity</FormMessage>
        </Flex>
        <Form.Control asChild>
          <input type="file" onChange={handleVideoChange} required />
        </Form.Control>
      </FormField>

      <Flex css={{ marginTop: 25, justifyContent: 'flex-end' }}>
        <Form.Submit asChild>
          <ButtonBlack state={isSubmitting ? "loading" : "none"} type="submit" css={{ marginTop: 10 }}>
            {isSubmitting ? "Uploading..." : "Create activity"}
          </ButtonBlack>
        </Form.Submit>
      </Flex>
    </FormLayout>
  );
}

export default VideoModal;
