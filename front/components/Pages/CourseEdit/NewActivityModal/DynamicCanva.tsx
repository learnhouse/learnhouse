import FormLayout, { ButtonBlack, Flex, FormField, FormLabel, FormMessage, Input, Textarea } from "@components/UI/Form/Form";
import React, { useState } from "react";
import * as Form from '@radix-ui/react-form';

function DynamicCanvaModal({ submitActivity, chapterId }: any) {
  const [activityName, setActivityName] = useState("");
  const [activityDescription, setActivityDescription] = useState("");

  const handleActivityNameChange = (e: any) => {
    setActivityName(e.target.value);
  };

  const handleActivityDescriptionChange = (e: any) => {
    setActivityDescription(e.target.value);
  };

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    console.log({ activityName, activityDescription, chapterId });
    submitActivity({
      name: activityName,
      chapterId: chapterId,
      type: "dynamic",
    });
  };
  return (
    <FormLayout onSubmit={handleSubmit}>
      <FormField name="dynamic-activity-name">
        <Flex css={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
          <FormLabel>Activity name</FormLabel>
          <FormMessage match="valueMissing">Please provide a name for your activity</FormMessage>
        </Flex>
        <Form.Control asChild>
          <Input onChange={handleActivityNameChange} type="text" required />
        </Form.Control>
      </FormField>
      <FormField name="dynamic-activity-desc">
        <Flex css={{ alignItems: 'baseline', justifyContent: 'space-between' }}>
          <FormLabel>Activity description</FormLabel>
          <FormMessage match="valueMissing">Please provide a description for your activity</FormMessage>
        </Flex>
        <Form.Control asChild>
          <Textarea onChange={handleActivityDescriptionChange} required />
        </Form.Control>
      </FormField>

      <Flex css={{ marginTop: 25, justifyContent: 'flex-end' }}>
        <Form.Submit asChild>
          <ButtonBlack type="submit" css={{ marginTop: 10 }}>Create Activity</ButtonBlack>
        </Form.Submit>
      </Flex>
    </FormLayout>
  );
}

export default DynamicCanvaModal;
